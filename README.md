# HoneypotForge

HoneypotForge состоит из control plane (FastAPI API, PostgreSQL и веб-интерфейс),
агента и шлюза mTLS для безопасного управления honeypot-инстансами.

## Быстрый запуск

### Требования

- Linux/macOS или Windows с Docker Desktop;
- Docker Engine 24+ и Docker Compose v2;
- свободные порты `3000`, `8000`, `8443` и `8444`.

### Запуск через Docker Compose

Из корня репозитория выполните:

```bash
cp .env.example .env
openssl rand -base64 48 | tr -d '\n' > /tmp/honeypotforge-secret
SECRET=$(cat /tmp/honeypotforge-secret)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
sed -i "s|^AGENT_GATEWAY_TOKEN=.*|AGENT_GATEWAY_TOKEN=$SECRET|" .env
rm /tmp/honeypotforge-secret

docker compose -f compose.yml up -d --build
```

На macOS и Windows вместо `sed` можно открыть `.env` вручную и заменить значения
`JWT_SECRET` и `AGENT_GATEWAY_TOKEN`. Оба значения должны содержать минимум 32
символа. Для реального развёртывания также задайте уникальные
`DB_PASSWORD`, `INITIAL_ADMIN_EMAIL` и `INITIAL_ADMIN_PASSWORD`.

После запуска:

- веб-интерфейс: <http://localhost:3000>;
- Swagger API: <http://localhost:8000/docs>;
- health check: <http://localhost:8000/health>;
- mTLS-шлюз агентов: `https://localhost:8443`;
- HTTPS API для enrollment: `https://localhost:8444`.

Проверить состояние и логи можно командами:

```bash
docker compose -f compose.yml ps
docker compose -f compose.yml logs -f api
```

Остановить сервисы без удаления данных:

```bash
docker compose -f compose.yml down
```

Для полного удаления данных PostgreSQL и созданных Docker volume используйте

```bash
docker compose -f compose.yml down -v
```

## Запуск QEMU-агента

Профиль QEMU запускается отдельно и требует bootstrap CA. Для локального
тестирования после запуска control plane выполните:

```bash
docker compose -f compose.yml --profile qemu up -d --build qemu-agent
```

Переменная `AGENT_BOOTSTRAP_CA` должна указывать на публичный bootstrap
сертификат, доступный Docker. Не передавайте агенту приватный ключ CA.

Подробности о managed-агенте находятся в [`agent/README.md`](agent/README.md).

## Локальная разработка API

Для запуска тестов API нужен [uv](https://docs.astral.sh/uv/):

```bash
cd control-plane/api
uv sync --dev
uv run ruff check src tests
uv run pytest -q
```

Документация API также доступна в [`control-plane/api/README.md`](control-plane/api/README.md).

## Структура проекта

- `control-plane/api` — FastAPI control plane и работа с PostgreSQL;
- `control-plane/frontend` — веб-интерфейс оператора;
- `control-plane/agent-gateway` — Nginx mTLS-шлюз;
- `agent` — Go-агент honeypot;
- `compose.yml` — локальное и контейнерное развёртывание;
- `deploy/ansible` — автоматизация серверного развёртывания.
