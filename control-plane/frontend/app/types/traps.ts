export type ServiceKey = string;

export type TrapLevel = "low" | "medium" | "high";

export type AgentStatusKey = "online" | "syncing" | "offline" | "error";

export interface TrapService {
  key: ServiceKey;
  port: number;
}

export type TrapEventSeverity = "info" | "warning" | "critical";

export type TrapEventAction = string;

export interface TrapEvent {
  id: string;
  trapId: string;
  ts: string;
  source: string;
  service: ServiceKey;
  port: number;
  action: TrapEventAction;
  severity: TrapEventSeverity;
  message: string;
}

/** Ловушка = DeploymentRead (+ агент, события, профиль агента). */
export interface Trap {
  id: string;
  name: string;
  profileId: string;
  description: string;
  services: TrapService[];
  level: TrapLevel;
  agentId: string;
  agentStatus: AgentStatusKey;
  honeypotType: string;
  driver: string;
  desiredState: string;
  observedState: string;
  lastError: string | null;
  eventsCount: number;
  events: TrapEvent[];
  createdAt: string;
}

/** Отображаемый шаблон профиля (ProfileRead → view). */
export interface TrapProfile {
  id: string;
  name: string;
  description: string;
  icon: string;
  level: TrapLevel;
  tags: string[];
  services: TrapService[];
}

export type TrapFieldKey =
  | "name"
  | "profile"
  | "services"
  | "port"
  | "level"
  | "agent"
  | "events"
  | "createdAt";

export interface TrapField {
  key: TrapFieldKey;
  label: string;
  sortable: boolean;
  defaultVisible: boolean;
  locked?: boolean;
}

export type TrapSortKey = TrapFieldKey | "profile";
export type SortDirection = "asc" | "desc";

export interface TrapSort {
  field: TrapSortKey;
  direction: SortDirection;
}
