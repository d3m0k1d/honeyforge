import type { AgentRead, EventRead, ProfileRead } from "~/types/api";
import type {
  AgentStatusKey,
  ServiceKey,
  Trap,
  TrapEvent,
  TrapEventSeverity,
  TrapField,
  TrapLevel,
  TrapProfile,
  TrapService,
} from "~/types/traps";

export interface ServiceMeta {
  key: ServiceKey;
  label: string;
  short: string;
  icon: string;
  defaultPort: number;
}

export const SERVICES: ServiceMeta[] = [
  { key: "ssh", label: "SSH", short: "SSH", icon: "i-lucide-terminal", defaultPort: 2222 },
  { key: "http", label: "HTTP", short: "HTTP", icon: "i-lucide-globe", defaultPort: 8080 },
  { key: "smtp", label: "SMTP", short: "SMTP", icon: "i-lucide-mail", defaultPort: 2525 },
  { key: "redis", label: "REDIS", short: "REDIS", icon: "i-lucide-layers", defaultPort: 6379 },
  { key: "tcp", label: "TCP", short: "TCP", icon: "i-lucide-network", defaultPort: 9000 },
  { key: "postgresql", label: "PostgreSQL", short: "PSQL", icon: "i-lucide-database", defaultPort: 5432 },
  { key: "mysql", label: "MySQL", short: "MYSQL", icon: "i-lucide-database", defaultPort: 3306 },
];

export const SERVICE_BY_KEY: Record<string, ServiceMeta> = SERVICES.reduce(
  (acc, service) => {
    acc[service.key] = service;
    return acc;
  },
  {} as Record<string, ServiceMeta>,
);

/** Синонимы, которые приходят из конфигов агента/событий → каноничный ключ UI. */
const DISPLAY_ALIASES: Record<string, string> = {
  psql: "postgresql",
  postgres: "postgresql",
  "http-nginx": "http",
  "http-apache": "http",
};

/** Синонимы UI-ключа → базовый тип каталога /honeypot-types (или null, если типа нет). */
const CATALOG_ALIASES: Record<string, string | null> = {
  postgresql: "postgres",
  psql: "postgres",
  postgres: "postgres",
  tcp: null,
};

/** Нормализовать ключ сервиса к виду UI (postgres → postgresql, http-nginx → http). */
export function displayServiceKey(raw: string): ServiceKey {
  const key = raw.trim().toLowerCase();

  return DISPLAY_ALIASES[key] ?? key;
}

/** Метаданные сервиса: известные типы из справочника, иначе универсальные. */
export function serviceMeta(key: ServiceKey): ServiceMeta {
  const normalized = displayServiceKey(key);
  const known = SERVICE_BY_KEY[normalized];

  if (known) return known;

  return {
    key: normalized,
    label: normalized.toUpperCase(),
    short: normalized.toUpperCase().slice(0, 6),
    icon: "i-lucide-plug",
    defaultPort: 0,
  };
}

/** Базовый тип каталога для создания deployment (null — типа нет в каталоге). */
export function catalogBase(key: ServiceKey): string | null {
  const normalized = displayServiceKey(key);

  if (normalized in CATALOG_ALIASES) return CATALOG_ALIASES[normalized]!;

  return normalized || null;
}

/** Slug типа ловушки для POST /deployments (ssh + medium → ssh-mid). */
export function catalogTypeFor(key: ServiceKey, level: TrapLevel): string | null {
  if (level === "high") return "qemu-high";

  const base = catalogBase(key);
  if (!base) return null;

  return `${base}-${level === "low" ? "low" : "mid"}`;
}

export const LEVELS: {
  key: TrapLevel;
  label: string;
  description: string;
  color: "neutral" | "warning" | "error";
}[] = [
  { key: "low", label: "Low", description: "Эмуляция баннера без файловой системы", color: "neutral" },
  { key: "medium", label: "Medium", description: "Эмуляция команд и структуры каталогов", color: "warning" },
  { key: "high", label: "High", description: "Полноценная песочница с журналированием", color: "error" },
];

export const LEVEL_BY_KEY: Record<TrapLevel, (typeof LEVELS)[number]> = LEVELS.reduce(
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
  { key: "online", label: "Online", dot: "bg-success", color: "success" },
  { key: "syncing", label: "Синхронизация", dot: "bg-info", color: "info" },
  { key: "offline", label: "Offline", dot: "bg-dimmed", color: "neutral" },
  { key: "error", label: "Ошибка", dot: "bg-error", color: "error" },
];

export const AGENT_STATUS_BY_KEY: Record<AgentStatusKey, (typeof AGENT_STATUSES)[number]> =
  AGENT_STATUSES.reduce(
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

export const ACTION_LABELS: Record<string, string> = {
  auth_fail: "Неудачная аутентификация",
  auth_success: "Успешный вход",
  auth: "Аутентификация",
  scan: "Сканирование",
  exploit: "Эксплуатация",
  command: "Выполнение команды",
  connect: "Подключение",
  transfer: "Передача данных",
  request: "HTTP-запрос",
  session: "Сессия",
};

export const SEVERITY_LABELS: Record<TrapEventSeverity, string> = {
  info: "Инфо",
  warning: "Предупреждение",
  critical: "Критично",
};

export const STATE_LABELS: Record<string, string> = {
  pending: "Ожидание",
  running: "Запущено",
  stopped: "Остановлено",
  deleted: "Удалено",
  error: "Ошибка",
};

export function stateLabel(state: string) {
  return STATE_LABELS[state] ?? state;
}

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

/** Иконка шаблона: по набору сервисов (мульти-сервис → «конструктор»). */
export function profileIconFor(keys: ServiceKey[]) {
  if (keys.length > 1) return "i-lucide-boxes";
  if (!keys.length) return "i-lucide-shield-alert";

  return serviceMeta(keys[0]!).icon;
}

/** Порт из listen вида ":2222" / "0.0.0.0:2222". */
export function parseListenPort(listen?: string | null): number | null {
  if (!listen) return null;

  const raw = listen.split(":").pop() ?? "";
  const port = Number(raw);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** ProfileRead → отображаемый шаблон (сервисы дедуплицируются по ключу UI). */
export function profileToTrapProfile(profile: ProfileRead): TrapProfile {
  const services: TrapService[] = [];
  const seen = new Set<ServiceKey>();

  for (const service of profile.services ?? []) {
    const key = displayServiceKey(service.type);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    services.push({
      key,
      port: parseListenPort(service.listen) ?? serviceMeta(key).defaultPort,
    });
  }

  const keys = services.map((service) => service.key);

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description?.trim() || "Описание не заполнено",
    icon: profileIconFor(keys),
    level: profile.level,
    tags: keys.map((key) => serviceMeta(key).short.toLowerCase()),
    services,
  };
}

/** Статус ловушки из состояний deployment + online-флага агента. */
export function deriveAgentStatus(
  deployment: { desired_state: string; observed_state: string; last_error: string | null },
  agent?: AgentRead,
): AgentStatusKey {
  if (deployment.observed_state === "error" || deployment.last_error) return "error";
  if (deployment.desired_state !== deployment.observed_state) return "syncing";
  if (deployment.observed_state === "running" && agent?.online) return "online";

  return "offline";
}

export function mapSeverity(raw?: string | null): TrapEventSeverity {
  const value = (raw ?? "").toLowerCase();

  if (["critical", "error", "high", "crit"].includes(value)) return "critical";
  if (["warning", "medium", "warn"].includes(value)) return "warning";

  return "info";
}

function eventMessage(event: EventRead): string {
  const detail = event.request ?? event.command ?? event.username ?? event.payload;

  return detail ? `${event.event} · ${detail}` : event.event;
}

/** EventRead → TrapEvent (порты/имена нормализуются к виду UI). */
export function mapEvent(
  event: EventRead,
  options: { trapId: string; port: number },
): TrapEvent {
  const service = displayServiceKey(event.service);

  return {
    id: event.event_id || String(event.id),
    trapId: options.trapId,
    ts: event.ts,
    source: event.src || "—",
    service,
    port: event.destination_port ?? options.port,
    action: event.event,
    severity: mapSeverity(event.severity ?? event.level),
    message: eventMessage(event),
  };
}

/**
 * Ловушка, которой принадлежит событие: агент + сервис (как в traps-сторе).
 * High-ловушки без списка сервисов совпадают по агенту.
 */
export function findTrapForEvent(
  traps: Trap[],
  agentId: string,
  service: string,
): Trap | null {
  const key = displayServiceKey(service);

  return (
    traps.find((trap) => {
      if (trap.agentId !== agentId) return false;
      if (!trap.services.length) return true;

      return trap.services.some((item) => item.key === key);
    }) ?? null
  );
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
  return serviceMeta(key).label;
}
