import type {
  AgentStatusKey,
  ServiceKey,
  Trap,
  TrapAgent,
  TrapEvent,
  TrapEventAction,
  TrapEventSeverity,
  TrapField,
  TrapLevel,
  TrapProfile,
  TrapService,
} from "~/types/traps";
import { createId } from "~/utils/schema";

export interface ServiceMeta {
  key: ServiceKey;
  label: string;
  short: string;
  icon: string;
  defaultPort: number;
}

export const SERVICES: ServiceMeta[] = [
  {
    key: "ssh",
    label: "SSH",
    short: "SSH",
    icon: "i-lucide-terminal",
    defaultPort: 2222,
  },
  {
    key: "http",
    label: "HTTP",
    short: "HTTP",
    icon: "i-lucide-globe",
    defaultPort: 8080,
  },
  {
    key: "smtp",
    label: "SMTP",
    short: "SMTP",
    icon: "i-lucide-mail",
    defaultPort: 2525,
  },
  {
    key: "redis",
    label: "REDIS",
    short: "REDIS",
    icon: "i-lucide-layers",
    defaultPort: 6379,
  },
  {
    key: "tcp",
    label: "TCP",
    short: "TCP",
    icon: "i-lucide-network",
    defaultPort: 9000,
  },
  {
    key: "postgresql",
    label: "PostgreSQL",
    short: "PSQL",
    icon: "i-lucide-database",
    defaultPort: 5432,
  },
  {
    key: "mysql",
    label: "MySQL",
    short: "MYSQL",
    icon: "i-lucide-database",
    defaultPort: 3306,
  },
];

export const SERVICE_BY_KEY: Record<ServiceKey, ServiceMeta> = SERVICES.reduce(
  (acc, service) => {
    acc[service.key] = service;
    return acc;
  },
  {} as Record<ServiceKey, ServiceMeta>,
);

export const LEVELS: {
  key: TrapLevel;
  label: string;
  description: string;
  color: "neutral" | "warning" | "error";
}[] = [
  {
    key: "low",
    label: "Low",
    description: "Эмуляция баннера без файловой системы",
    color: "neutral",
  },
  {
    key: "medium",
    label: "Medium",
    description: "Эмуляция команд и структуры каталогов",
    color: "warning",
  },
  {
    key: "high",
    label: "High",
    description: "Полноценная песочница с журналированием",
    color: "error",
  },
];

export const LEVEL_BY_KEY: Record<TrapLevel, (typeof LEVELS)[number]> =
  LEVELS.reduce(
    (acc, level) => {
      acc[level.key] = level;
      return acc;
    },
    {} as Record<TrapLevel, (typeof LEVELS)[number]>,
  );

export const AGENT_STATUSES: {
  key: AgentStatusKey;
  label: string;
  dot: string;
  color: "neutral" | "info" | "success" | "error";
}[] = [
  {
    key: "online",
    label: "Online",
    dot: "bg-success",
    color: "success",
  },
  {
    key: "syncing",
    label: "Синхронизация",
    dot: "bg-info",
    color: "info",
  },
  {
    key: "offline",
    label: "Offline",
    dot: "bg-dimmed",
    color: "neutral",
  },
  {
    key: "error",
    label: "Ошибка",
    dot: "bg-error",
    color: "error",
  },
];

export const AGENT_STATUS_BY_KEY: Record<
  AgentStatusKey,
  (typeof AGENT_STATUSES)[number]
> = AGENT_STATUSES.reduce(
  (acc, status) => {
    acc[status.key] = status;
    return acc;
  },
  {} as Record<AgentStatusKey, (typeof AGENT_STATUSES)[number]>,
);

export const TRAP_FIELDS: TrapField[] = [
  { key: "name", label: "Название", sortable: true, defaultVisible: true, locked: true },
  { key: "profile", label: "Профиль", sortable: true, defaultVisible: true },
  { key: "services", label: "Сервисы", sortable: true, defaultVisible: true },
  { key: "port", label: "Порт", sortable: true, defaultVisible: true },
  { key: "level", label: "Уровень", sortable: true, defaultVisible: true },
  { key: "agent", label: "Агент", sortable: true, defaultVisible: true },
  { key: "events", label: "События", sortable: true, defaultVisible: true },
  { key: "createdAt", label: "Создана", sortable: true, defaultVisible: false },
];

export const PROFILES: TrapProfile[] = [
  {
    id: "corp-portal",
    name: "Корпоративный портал",
    description:
      "Веб-приложение с формой входа, каталогом документов и поддельными объявлениями. Ловит credential stuffing и сканы уязвимостей.",
    icon: "i-lucide-building-2",
    level: "medium",
    tags: ["веб", "формы", "фишинг"],
    services: [{ key: "http", port: 8080 }],
  },
  {
    id: "linux-server",
    name: "Linux-сервер",
    description:
      "SSH-доступ с эмуляцией bash, списками файлов и историей команд. Основная цель — подбор паролей и разведка.",
    icon: "i-lucide-server",
    level: "medium",
    tags: ["ssh", "bruteforce"],
    services: [{ key: "ssh", port: 2222 }],
  },
  {
    id: "mail-gateway",
    name: "Почтовый шлюз",
    description:
      "SMTP-релей с открытым приемом писем и фейковыми ящиками сотрудников. Фиксирует спам-рассылки и фишинг.",
    icon: "i-lucide-mail",
    level: "low",
    tags: ["smtp", "релей"],
    services: [{ key: "smtp", port: 2525 }],
  },
  {
    id: "postgres-db",
    name: "База PostgreSQL",
    description:
      "SQL-сервер с поддельными таблицами клиентов и платежей. Реагирует на sql-инъекции и перебор creed'ов.",
    icon: "i-lucide-database",
    level: "high",
    tags: ["sql", "данные"],
    services: [{ key: "postgresql", port: 5432 }],
  },
  {
    id: "mysql-db",
    name: "База MySQL",
    description:
      "Классический MySQL-инстанс со схемой интернет-магазина и тестовыми дампами.",
    icon: "i-lucide-database",
    level: "medium",
    tags: ["sql", "магазин"],
    services: [{ key: "mysql", port: 3306 }],
  },
  {
    id: "redis-cache",
    name: "Кэш Redis",
    description:
      "Незащищенный Redis с эмуляцией KEYS, GET и CONFIG. Ловит криптомайнеры и попытки RCE.",
    icon: "i-lucide-layers",
    level: "low",
    tags: ["nosql", "rce"],
    services: [{ key: "redis", port: 6379 }],
  },
  {
    id: "tcp-sink",
    name: "Сетевая заглушка",
    description:
      "Универсальный TCP-порт, который принимает и журналирует любой входящий трафик без протокола.",
    icon: "i-lucide-network",
    level: "low",
    tags: ["tcp", "raw"],
    services: [{ key: "tcp", port: 9000 }],
  },
  {
    id: "hybrid-edge",
    name: "Гибридный периметр",
    description:
      "Несколько сервисов на одном агенте: веб-фасад, управляющий SSH и служебный TCP. Для сложных сценариев атак.",
    icon: "i-lucide-boxes",
    level: "high",
    tags: ["мульти", "периметр"],
    services: [
      { key: "http", port: 8080 },
      { key: "ssh", port: 2222 },
      { key: "tcp", port: 9000 },
    ],
  },
];

export const PROFILE_BY_ID: Record<string, TrapProfile> = PROFILES.reduce(
  (acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  },
  {} as Record<string, TrapProfile>,
);

export const AGENTS: TrapAgent[] = [
  {
    id: "agent_edge_01",
    name: "edge-01",
    host: "10.20.0.11",
    version: "2.4.1",
    uptime: "14 д 06:12",
  },
  {
    id: "agent_edge_02",
    name: "edge-02",
    host: "10.20.0.17",
    version: "2.4.1",
    uptime: "3 д 21:45",
  },
  {
    id: "agent_dmz_01",
    name: "dmz-01",
    host: "10.20.4.3",
    version: "2.3.8",
    uptime: "41 д 02:03",
  },
  {
    id: "agent_lab_01",
    name: "lab-01",
    host: "10.30.1.8",
    version: "2.4.1",
    uptime: "00 д 11:27",
  },
];

export const AGENT_BY_ID: Record<string, TrapAgent> = AGENTS.reduce(
  (acc, agent) => {
    acc[agent.id] = agent;
    return acc;
  },
  {} as Record<string, TrapAgent>,
);

export const EVENTS_CONFIG: Record<ServiceKey, string[]> = {
  ssh: [
    "неудачная аутентификация root",
    "подбор пароля, попыток за минуту: 42",
    "выполнена команда: cat /etc/passwd",
    "сессия закрыта атакующим",
  ],
  http: [
    "GET /admin — 404",
    "POST /login — попытка входа",
    "скан директорий /backup, /config",
    "SQL-инъекция в параметре id",
  ],
  smtp: ["получено письмо от неизвестного отправителя", "Relay denied", "спам-рассылка заблокирована"],
  redis: ["команда KEYS *", "попытка CONFIG SET dir /tmp", "команда INFO"],
  tcp: ["входящее соединение", "передано 1.2 КБ", "сканирование порта"],
  postgresql: ["подключение к базе shop_prod", "неизвестный пользователь postgres", "дамп таблицы customers"],
  mysql: ["подключение пользователем root", "выборка из information_schema"],
};

function daysAgo(days: number) {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString();
}

function minutesAgo(minutes: number) {
  const date = new Date(Date.now() - minutes * 60_000);
  return date.toISOString();
}

function hashSeed(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Часть IP активна постоянно — по ним строится топ атакующих
const ATTACKER_POOL = [
  "185.220.101.4",
  "45.155.205.12",
  "193.32.162.44",
  "103.152.44.9",
  "91.240.118.172",
  "62.204.41.88",
  "217.160.27.140",
  "5.188.206.18",
  "194.26.229.38",
  "89.248.165.212",
  "141.98.10.63",
  "171.25.193.202",
];

const PERSISTENT_ATTACKERS = 3;

const ACTIONS_BY_SERVICE: Record<ServiceKey, TrapEventAction[]> = {
  ssh: ["auth_fail", "auth_fail", "auth_fail", "auth_success", "command"],
  http: ["scan", "scan", "exploit", "auth_fail", "connect"],
  smtp: ["connect", "transfer", "connect", "scan"],
  redis: ["command", "exploit", "command", "connect"],
  tcp: ["connect", "scan", "connect", "transfer"],
  postgresql: ["connect", "auth_fail", "exploit", "command"],
  mysql: ["connect", "auth_fail", "exploit", "command"],
};

export const ACTION_LABELS: Record<TrapEventAction, string> = {
  auth_fail: "Неудачная аутентификация",
  auth_success: "Успешный вход",
  scan: "Сканирование",
  exploit: "Эксплуатация",
  command: "Выполнение команды",
  connect: "Подключение",
  transfer: "Передача данных",
};

export const ACTION_SEVERITY: Record<TrapEventAction, TrapEventSeverity> = {
  auth_fail: "warning",
  auth_success: "critical",
  scan: "info",
  exploit: "critical",
  command: "warning",
  connect: "info",
  transfer: "info",
};

export const SEVERITY_LABELS: Record<TrapEventSeverity, string> = {
  info: "Инфо",
  warning: "Предупреждение",
  critical: "Критично",
};

function seedEvents(
  trapId: string,
  services: TrapService[],
  count: number,
): TrapEvent[] {
  const rand = mulberry32(hashSeed(trapId));

  const events: TrapEvent[] = Array.from({ length: count }, () => {
    const service = services[Math.floor(rand() * services.length)]!;
    const action =
      ACTIONS_BY_SERVICE[service.key][
        Math.floor(rand() * ACTIONS_BY_SERVICE[service.key].length)
      ] ?? "connect";
    const messages = EVENTS_CONFIG[service.key];

    const source =
      rand() < 0.45
        ? ATTACKER_POOL[Math.floor(rand() * PERSISTENT_ATTACKERS)]!
        : ATTACKER_POOL[Math.floor(rand() * ATTACKER_POOL.length)]!;

    const ageMinutes = 30 + Math.floor(rand() * 60 * 24 * 21);

    return {
      id: createId("evt"),
      trapId,
      ts: minutesAgo(ageMinutes),
      source,
      service: service.key,
      port: service.port,
      action,
      severity: ACTION_SEVERITY[action] ?? "info",
      message: messages[Math.floor(rand() * messages.length)] ?? "событие",
    };
  });

  return events.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

function trap(partial: Omit<Trap, "events">): Trap {
  const eventsCount = partial.eventsCount;

  return {
    ...partial,
    events: seedEvents(
      partial.id,
      partial.services,
      Math.min(eventsCount, 24),
    ),
  };
}

export function seedTraps(): Trap[] {
  return [
    trap({
      id: "trap_ssh_edge01",
      name: "ssh-prod-01",
      profileId: "linux-server",
      description: "Боевой SSH-ловушка на edge-01 для внешнего периметра",
      services: [{ key: "ssh", port: 2222 }],
      level: "medium",
      agentId: "agent_edge_01",
      agentStatus: "online",
      eventsCount: 1842,
      createdAt: daysAgo(41),
    }),
    trap({
      id: "trap_http_portal",
      name: "corp-portal-web",
      profileId: "corp-portal",
      description: "Поддельный корпоративный портал с формой входа",
      services: [{ key: "http", port: 8080 }],
      level: "medium",
      agentId: "agent_edge_02",
      agentStatus: "online",
      eventsCount: 3120,
      createdAt: daysAgo(28),
    }),
    trap({
      id: "trap_pg_finance",
      name: "pg-finance",
      profileId: "postgres-db",
      description: "База финансового департамента, высокий уровень эмуляции",
      services: [{ key: "postgresql", port: 5432 }],
      level: "high",
      agentId: "agent_dmz_01",
      agentStatus: "online",
      eventsCount: 704,
      createdAt: daysAgo(17),
    }),
    trap({
      id: "trap_smtp_relay",
      name: "mail-relay-dmz",
      profileId: "mail-gateway",
      description: "Открытый SMTP-релей для анализа фишинга",
      services: [{ key: "smtp", port: 2525 }],
      level: "low",
      agentId: "agent_dmz_01",
      agentStatus: "syncing",
      eventsCount: 512,
      createdAt: daysAgo(12),
    }),
    trap({
      id: "trap_redis_lab",
      name: "redis-cache-lab",
      profileId: "redis-cache",
      description: "Тестовый Redis в лабораторном сегменте",
      services: [{ key: "redis", port: 6379 }],
      level: "low",
      agentId: "agent_lab_01",
      agentStatus: "error",
      eventsCount: 96,
      createdAt: daysAgo(6),
    }),
    trap({
      id: "trap_mysql_shop",
      name: "mysql-shop-backup",
      profileId: "mysql-db",
      description: "Резервная копия магазина с устаревшей версией MySQL",
      services: [{ key: "mysql", port: 3306 }],
      level: "medium",
      agentId: "agent_edge_02",
      agentStatus: "online",
      eventsCount: 388,
      createdAt: daysAgo(9),
    }),
    trap({
      id: "trap_tcp_scan",
      name: "tcp-sink-honeypot",
      profileId: "tcp-sink",
      description: "Заглушка для перехвата сканов портов",
      services: [{ key: "tcp", port: 9000 }],
      level: "low",
      agentId: "agent_lab_01",
      agentStatus: "offline",
      eventsCount: 1204,
      createdAt: daysAgo(33),
    }),
    trap({
      id: "trap_hybrid_perimeter",
      name: "hybrid-perimeter",
      profileId: "hybrid-edge",
      description: "Комбинированная ловушка: веб, SSH и служебный порт",
      services: [
        { key: "http", port: 8080 },
        { key: "ssh", port: 2222 },
        { key: "tcp", port: 9000 },
      ],
      level: "high",
      agentId: "agent_dmz_01",
      agentStatus: "online",
      eventsCount: 2270,
      createdAt: daysAgo(4),
    }),
    trap({
      id: "trap_ssh_archive",
      name: "ssh-archive-2025",
      profileId: "linux-server",
      description: "Архивная ловушка, агент выведен из эксплуатации",
      services: [{ key: "ssh", port: 22 }],
      level: "medium",
      agentId: "agent_lab_01",
      agentStatus: "offline",
      eventsCount: 45,
      createdAt: daysAgo(63),
    }),
  ];
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEvents(count: number) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }

  return String(count);
}

export function trapPorts(trap: Trap) {
  return trap.services.map((service) => service.port);
}

export function serviceLabel(key: ServiceKey) {
  return SERVICE_BY_KEY[key]?.label ?? key;
}
