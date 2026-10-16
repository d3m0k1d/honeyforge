# Полный backlog Go-agent и QEMU high-interaction

Документ предназначен для разработчика агента. Он разделяет уже работающую базу и
задачи, необходимые для полного соответствия максимальным требованиям кейса.

## Что уже работает и не должно быть переписано без причины

- mTLS enrollment и проверка CA/client certificate;
- heartbeat, получение versioned config и command polling;
- low/medium эмуляторы `imitor`;
- события connect/disconnect/input/rule;
- durable event spool: 10 000 записей, 64 MiB, batch до 100;
- повторная доставка событий после рестарта и потери связи;
- command claim, lease renewal и отправка результата;
- QEMU qcow2 overlay, resize, start/stop/destroy;
- cloud-init seed и ожидание completion marker;
- QMP snapshots и reset;
- offline shell и single-file Ansible provisioning через `virt-customize`.

Текущие ограничения:

- `/sessions`, `/artifacts` и `/honeytoken-triggers` агентом не используются;
- QEMU-гость не отправляет attack telemetry;
- Ansible поддерживает только один YAML и требует `ansible-playbook` внутри image;
- `entrypoint` deployment artifact агент игнорирует;
- base qcow2 вручную размещается в `QEMU_IMAGE_DIR`;
- `/dev/kvm` не проброшен, `-enable-kvm` отсутствует;
- команды `reconcile`, `update`, `rotate_credentials` QEMU executor не понимает;
- auto-reset, retention incident snapshots и ротация mTLS не реализованы.

## Общий Definition of Done

Для каждой задачи:

1. Поведение покрыто table-driven unit tests.
2. Сетевые и файловые операции имеют context, timeout и размерные лимиты.
3. После ошибки сохраняется предыдущая рабочая конфигурация/VM/сертификат.
4. Секреты, credentials, payload и приватные ключи не попадают в обычные логи.
5. `go test -race ./...`, `go vet ./...` и `go test -tags=integration ./...`
   проходят.
6. Повтор запроса после timeout не создаёт дубль и не повторяет необратимую операцию.
7. Новые goroutines завершаются по context; тесты таймеров используют управляемое время.

---

## P0. Обязательная агентская телеметрия

### AG-01. Перейти на замаскированные gateway paths

**Размер:** S  
**Зависимости:** нет

Заменить внешние пути:

| Операция | Новый путь |
|---|---|
| Heartbeat | `POST /assets/status` |
| Config | `GET /assets/manifest.json` |
| Events | `POST /assets/collect` |
| Sessions | `POST /assets/runtime` |
| Captured artifacts | `POST /assets/blob` |
| Honeytoken triggers | `POST /assets/pixel` |
| Commands | `/assets/tasks/*` |

Старые `/events`, `/config`, `/commands/*` являются временной совместимостью.

**Приёмка:** managed integration test использует только `/assets/*`; явные старые пути
не встречаются в agent binary strings и логах.

### AG-02. Полная модель agent config

**Размер:** M  
**Зависимости:** нет

Расширить `agent/internal/config`:

- `log.capture_connections`;
- `log.capture_credentials`;
- `log.capture_commands`;
- `log.capture_requests`;
- `log.capture_payloads`;
- `log.capture_session_content`;
- `log.max_payload_bytes`;
- `masking.endpoint_path`, `beacon_interval_seconds`, `jitter_seconds`,
  `padding_bytes`, `mgmt_interface`;
- `honeytokens[]` со всеми полями API.

Каждая опция должна реально управлять сбором, а не только десериализоваться.

**Приёмка:** полный config проходит round-trip; некорректный config не заменяет cached
working config; payload обрезается до лимита с признаком `_truncated`.

### AG-03. Единая typed telemetry model

**Размер:** M  
**Зависимости:** AG-02

Ввести внутренние типы `Event`, `SessionReport`, `ArtifactReference`,
`HoneytokenTrigger`. Для каждого TCP/HTTP соединения создавать один UUID session ID.

Event `data` должен уметь передавать:

- `protocol`, `source_port`, `destination_port`;
- `username`, `password`/credential fields;
- `command`, `request`, `payload`;
- `session_id`;
- дополнительные protocol-specific поля.

Не выполнять внешний GeoIP lookup из сегмента ловушки. Geo/ASN оставлять центру.

**Приёмка:** fake-SSH фиксирует connect → auth → commands → disconnect; fake-HTTP —
method/path/headers/body; все события соединения содержат одинаковый session UUID.

### AG-04. Обобщённый durable spool

**Размер:** L  
**Зависимости:** AG-03

Не копировать текущий spool три раза. Выделить ограниченную persistent queue с типом
record и отдельными каталогами:

- `events/`;
- `sessions/`;
- `triggers/`;
- `artifact-jobs/`.

Свойства:

- UUID создаётся до записи и сохраняется между рестартами;
- atomic write + file sync + directory sync;
- bounded bytes/files;
- FIFO ordering внутри типа;
- exponential backoff с jitter;
- poison record после ограниченного количества permanent `4xx` переносится в
  `rejected/`, не блокируя очередь;
- `401/403` останавливает отправку и поднимает health error;
- `429/5xx/network timeout` повторяется.

**Приёмка:** kill/restart в каждой точке записи не теряет подтверждённые данные и не
удаляет неподтверждённые; race и corruption tests проходят.

### AG-05. Жизненный цикл attack sessions

**Размер:** L  
**Зависимости:** AG-03, AG-04

Endpoint: `POST /assets/runtime`, batch до 100.

```json
{
  "sessions": [{
    "id": "UUID",
    "started_at": "2026-10-14T10:00:00Z",
    "ended_at": "2026-10-14T10:01:12Z",
    "service": "ssh",
    "level": "medium",
    "src": "192.0.2.10:54321",
    "protocol": "tcp",
    "source_port": 54321,
    "destination_port": 22,
    "username": "root",
    "credentials": {"username": "root", "password": "toor"},
    "commands": ["id"],
    "requests": [],
    "transcript": "$ id\nuid=0(root)",
    "data": {"disconnect_reason": "eof"}
  }]
}
```

На connect записывать initial report с `ended_at=null`. На disconnect обновлять тот же
UUID. При аварийном рестарте незакрытые сессии завершать с `disconnect_reason=agent_restart`.

**Приёмка:** API выполняет upsert, повтор не дублирует session, `duration_ms` корректен,
transcript подчиняется logging policy и size limit.

### AG-06. Honeytoken materializer и trigger delivery

**Размер:** L  
**Зависимости:** AG-02, AG-04

1. Проверять encoding и SHA-256 содержимого.
2. Разрешать target path только внутри configurable allow-listed roots.
3. Использовать безопасную работу относительно directory FD/`os.Root`; запретить
   symlink traversal.
4. Создавать файл атомарно с минимальными правами.
5. Удалять снятые из config tokens, не следуя symlink.
6. Отслеживать read/write/rename/delete или protocol-specific use.
7. Отправлять стабильный UUID в `POST /assets/pixel`.

```json
{
  "id": "UUID",
  "honeytoken_id": 42,
  "triggered_at": "2026-10-14T10:02:00Z",
  "src": "192.0.2.10",
  "context": {"path": "/srv/fake/.env", "operation": "read"}
}
```

**Приёмка:** path traversal, hardlink/symlink escape и checksum mismatch отклоняются;
trigger переживает рестарт; duplicate UUID идемпотентен.

### AG-07. Captured artifact uploader

**Размер:** L  
**Зависимости:** AG-04, AG-05

Endpoint: `POST /assets/blob`, multipart, максимум 10 MiB:

- `artifact_id`, `kind`, `session_id`, `event_id`;
- lowercase `checksum_sha256`;
- JSON `metadata`;
- streaming file body.

Файл сначала переносится в private immutable spool, hash считается потоково. Не читать
весь файл в RAM. Удалять локальную копию только после успешного ответа с совпадающими
UUID/hash.

**Приёмка:** timeout после фактического сохранения на сервере безопасно повторяется;
неверный hash получает `422`; UUID с другим содержимым — `409`; oversize job не создаёт
бесконечный retry.

### AG-08. Beacon jitter, padding и backoff

**Размер:** M  
**Зависимости:** AG-02

Заменить фиксированный ticker на cancelable scheduler. Интервал выбирать в диапазоне,
заданном config; padding добавлять только в разрешённые POST envelopes. Retry backoff не
должен синхронизировать парк агентов.

**Приёмка:** статистический deterministic test подтверждает вариативность; context cancel
немедленно останавливает timer; padding не попадает в telemetry data.

---

## P1. QEMU high-interaction

### AG-09. Поддержка KVM с безопасным fallback

**Размер:** M  
**Зависимости:** инфраструктурная настройка test-server

- пробросить `/dev/kvm` в Compose;
- добавить только необходимую group/device permission;
- определять доступность KVM при старте;
- использовать `-enable-kvm -cpu host` при наличии;
- разрешить TCG fallback только явной настройкой;
- возвращать capability в heartbeat/status.

**Приёмка:** на test-server VM действительно использует KVM; при отсутствии KVM агент
либо fail-fast, либо явно сообщает `acceleration=tcg`; контейнер не получает `privileged`.

### AG-10. Изоляция QEMU networking

**Размер:** L  
**Зависимости:** AG-09

Разделить decoy и management traffic:

- decoy NIC принимает только опубликованные honeypot ports;
- management канал недоступен атакующему из гостевой ОС;
- запрет исходящего доступа в production/LAN;
- allow-list DNS/NTP/package mirror только если это требуется профилем;
- host forwarding проверяется на конфликты со всеми deployments, не только внутри одной.

Предпочтительный канал high telemetry — `virtio-serial`/host relay, а не обычное
исходящее соединение гостя в Control API.

**Приёмка:** из VM недоступны test-server LAN и Control API; опубликованный decoy port
работает; telemetry проходит через отдельный канал.

### AG-11. Guest sensor для high-interaction

**Размер:** XL  
**Зависимости:** AG-03–AG-07, AG-10

Создать отдельный минимальный guest component:

- install через provisioning/cloud-init;
- сбор login/auth, process exec, shell input/output, network metadata;
- фиксация uploaded/downloaded files;
- session UUID и transcript;
- передача host-agent через framed authenticated local channel;
- guest-side bounded spool при недоступности host relay;
- отсутствие прямых Control API credentials внутри VM.

Host-agent валидирует deployment ID и добавляет agent identity, затем использует обычные
spools событий/сессий/artifacts.

**Приёмка:** SSH-атака на VM появляется в events и sessions; загруженный файл доступен в
`/artifacts`; отключение relay не теряет данные; компрометация guest не раскрывает mTLS key
host-agent.

### AG-12. Полный lifecycle и reconciliation

**Размер:** L  
**Зависимости:** AG-09

Реализовать команды:

- `reconcile`: сравнить desired config с фактическим disk/process/QMP state;
- `update`: подготовить новую generation, проверить, атомарно переключить и откатить;
- `rotate_credentials`: заменить только bait credentials;
- корректное восстановление после рестарта host-agent;
- обнаружение stale PID и чужого процесса вместо доверия одному PID-файлу.

**Приёмка:** повтор команды не дублирует операцию; crash после каждого шага восстанавливает
консистентное состояние; unsupported transition возвращает controlled error.

### AG-13. Durable command journal

**Размер:** M  
**Зависимости:** AG-12

До выполнения команды атомарно сохранять command ID, generation, type и phase. После
side effect сохранять result до HTTP report. При lease expiry/restart возвращать сохранённый
result, а не повторять действие.

Особенно важно для `snapshot`, `reset`, `destroy`, provisioning и credential rotation.

**Приёмка:** потеря сети после side effect не создаёт второй snapshot и не запускает
provisioning повторно.

### AG-14. Snapshot policy и auto-reset

**Размер:** L  
**Зависимости:** AG-11–AG-13

- выполнять `reset_interval_minutes`;
- перед reset создавать incident snapshot при включённой политике;
- применять `max_incident_snapshots`;
- не удалять snapshot, пока backend не подтвердил новое состояние;
- получать реальный checksum экспортируемого snapshot либо не заявлять checksum;
- корректно обрабатывать нехватку диска.

**Приёмка:** clean snapshot восстанавливает VM; incident retention соблюдается после
рестарта; заполненный диск переводит deployment в error без повреждения clean snapshot.

---

## P1. Provisioning, Ansible и загрузка файлов в VM

### AG-15. Сделать `entrypoint` рабочим контрактом

**Размер:** S  
**Зависимости:** нет

Агент сейчас игнорирует artifact `entrypoint`. Добавить его в command payload model,
проверять `filepath.IsLocal`, запрещать абсолютные пути, `..`, NUL и control characters.

**Приёмка:** выполняется только заявленный entrypoint; отсутствие entrypoint или выход за
root отклоняется до изменения disk.

### AG-16. Shell artifact provisioning

**Размер:** M  
**Зависимости:** AG-13, AG-15

- проверить SHA-256 из response header;
- сохранить artifact атомарно;
- выполнять только через `virt-customize --run`, без `sh -c` на host;
- передавать минимальный allow-list environment;
- ограничить timeout/output;
- сохранять redacted provisioning log в command result;
- повторный запуск защищать command journal.

**Приёмка:** shell script создаёт ожидаемый файл внутри qcow2; command injection через имя,
entrypoint и metadata невозможен; timeout завершает `virt-customize`.

### AG-17. Полноценный Ansible bundle

**Размер:** XL  
**Зависимости:** AG-13, AG-15

Заменить single YAML на versioned archive contract, например `tar.gz`:

```text
manifest.json
site.yml
roles/...
collections/...
files/...
```

`manifest.json` содержит format version, entrypoint и checksums всех файлов.

Требования:

- streaming download + SHA-256;
- безопасная распаковка без absolute path, `..`, device files, symlinks/hardlinks наружу;
- лимиты compressed/uncompressed size и количества файлов;
- vendored roles/collections без Internet download;
- upload bundle в private guest directory;
- запуск `ansible-playbook --connection=local -i localhost, <entrypoint>`;
- гарантированное удаление bundle и временных secrets из guest;
- JSON callback/result с redaction sensitive values.

Base image contract должен явно указывать наличие совместимой версии `ansible-core`.
Автоматическая установка из Internet запрещена по умолчанию.

**Приёмка:** bundle с role/files/templates выполняется на Ubuntu image; malicious archive
не выходит за staging root; отсутствие Ansible даёт понятную preflight error до запуска VM.

### AG-18. Cloud-init как отдельный provisioning stage

**Размер:** M  
**Зависимости:** AG-13

- не смешивать cloud-init и artifact completion;
- валидировать MIME/cloud-config до записи;
- поддержать per-stage timeout/status;
- completion marker сделать уникальным для command ID;
- serial log ограничить и ротировать;
- не включать secrets в `final_message` и command error.

**Приёмка:** повторный deploy не исполняет user-data второй раз; ложный старый marker не
завершает новую command; serial log не растёт бесконечно.

### AG-19. Управление base images

**Размер:** XL, требует изменений Control API  
**Зависимости:** решение по object storage

Сейчас image вручную кладётся в read-only `QEMU_IMAGE_DIR`. Нужен отдельный lifecycle:

- registry metadata: ID/version/OS/size/SHA-256/signature;
- resumable/streaming download вне 10 MiB deployment artifact endpoint;
- allow-list image IDs вместо произвольного имени;
- проверка `qemu-img info --output=json`;
- запрет неожиданной backing chain;
- atomic promotion после полной проверки;
- reference counting и безопасная очистка старых версий.

**Приёмка:** повреждённый/подменённый image не используется; активная deployment не теряет
base image; новый image можно доставить без ручного SSH на host.

---

## P2. Безопасность, маскировка и эксплуатация

### AG-20. mTLS pinning, expiry и rotation

**Размер:** L, требует rotation endpoint Control API  
**Зависимости:** backend certificate lifecycle

- pin CA/public key из bootstrap config;
- проверять EKU, SAN/CN и expiry;
- предупреждать до истечения;
- получать новый bundle по authenticated rotation flow;
- validate new bundle до atomic `fsync + rename`;
- сохранять предыдущий bundle до server confirmation;
- никогда не переходить на insecure TLS.

**Приёмка:** MITM и неверный agent certificate отклоняются; повреждённая rotation не ломает
старый канал; private key имеет `0600`.

### AG-21. Скрытность host-agent

**Размер:** M  
**Зависимости:** AG-01, AG-08

- нейтральные имя binary/service/state directory;
- отсутствие `honeypot`, `c2`, control URLs в process arguments;
- secrets только в protected files/env injection;
- логи без характерных payload/credential строк;
- документировать границу: маскировка не заменяет mTLS и firewall.

**Приёмка:** process listing и unit file не раскрывают назначение; grep runtime filesystem
не находит private key/token вне state directory.

### AG-22. Health и локальная наблюдаемость

**Размер:** M  
**Зависимости:** основные P0 задачи

Добавить bounded local status:

- config version;
- last successful heartbeat/upload;
- queue depth/bytes по типам;
- rejected records;
- certificate expiry;
- QEMU/KVM capability;
- deployment process/QMP state;
- provisioning phase.

Не публиковать endpoint в decoy network. Данные отправлять в heartbeat после расширения
API или отдавать только локальному supervisor.

### AG-23. Resource limits и shutdown

**Размер:** M  
**Зависимости:** AG-04, AG-11

- bounded workers для upload и guest relay;
- лимиты одновременных sessions/artifacts;
- graceful shutdown: перестать принимать новое, завершить запись spool, остановить
  goroutines, не ждать сеть бесконечно;
- goleak tests для managed loop, relay и upload workers.

**Приёмка:** flood не создаёт unbounded goroutines/files; SIGTERM не повреждает spool;
race detector и goleak проходят.

---

## P0/P1. Обязательный тестовый контур

### AG-24. Contract tests с Control API

**Размер:** L  
**Зависимости:** AG-01–AG-08

Поднимать настоящий FastAPI/PostgreSQL/gateway и проверять:

- enrollment + mTLS;
- config versioning;
- event retry/deduplication;
- session initial/final upsert;
- artifact multipart/hash/idempotency;
- honeytoken trigger;
- command claim/lease/result;
- revoked agent получает `401`.

### AG-25. Реальный QEMU integration suite

**Размер:** XL  
**Зависимости:** AG-09–AG-18

Build tag `integration`; использовать минимальный подписанный test image. Проверять:

1. overlay и boot;
2. shell provisioning;
3. Ansible bundle с role/template/file;
4. cloud-init completion;
5. start/stop/restart;
6. snapshot/change/reset;
7. guest telemetry и captured file;
8. network isolation;
9. crash/restart command journal;
10. destroy и очистку ресурсов.

Тест должен доказывать boot работающей ОС, а не только успешный exit `qemu -daemonize`.

### AG-26. Security and fuzz suite

**Размер:** L  
**Зависимости:** AG-06, AG-07, AG-17, AG-19

- fuzz config/event/session decoders;
- malicious tar/zip corpus;
- symlink/hardlink/path traversal tests;
- command/path argument injection;
- oversized payloads и decompression bombs;
- corrupted spool recovery;
- TLS wrong CA/expired cert/hostname mismatch;
- `gosec` и `govulncheck` в CI.

---

## Рекомендуемый порядок выполнения

1. **AG-01 → AG-02 → AG-03 → AG-04** — фундамент агента.
2. **AG-05, AG-06, AG-07, AG-08** — закрытие low/medium и telemetry API.
3. **AG-15, AG-16, AG-13** — надёжный текущий provisioning.
4. **AG-09, AG-10, AG-12, AG-14** — production QEMU lifecycle.
5. **AG-17, AG-18** — полный Ansible/cloud-init.
6. **AG-11** — high-interaction telemetry.
7. **AG-19, AG-20** — image/certificate lifecycle вместе с backend.
8. **AG-21–AG-23** — hardening и эксплуатация.
9. **AG-24–AG-26** выполняются параллельно соответствующим эпикам, а не в самом конце.

## Минимальная граница готовности для демонстрации

Для честного заявления «maximum demo» обязательны как минимум:

- AG-01–AG-08;
- AG-09–AG-18, кроме AG-19;
- AG-24 и AG-25;
- живая демонстрация: атака low/medium и SSH в QEMU VM → events/session → captured file →
  incident snapshot → reset к clean snapshot.
