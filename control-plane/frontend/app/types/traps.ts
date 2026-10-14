export type ServiceKey =
  | "ssh"
  | "http"
  | "smtp"
  | "redis"
  | "tcp"
  | "postgresql"
  | "mysql";

export type TrapLevel = "low" | "medium" | "high";

export type AgentStatusKey = "online" | "syncing" | "offline" | "error";

export interface TrapService {
  key: ServiceKey;
  port: number;
}

export type TrapEventSeverity = "info" | "warning" | "critical";

export type TrapEventAction = "auth_fail" | "auth_success" | "scan" | "exploit" | "command" | "connect" | "transfer";

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

export interface Trap {
  id: string;
  name: string;
  profileId: string;
  description: string;
  services: TrapService[];
  level: TrapLevel;
  agentId: string;
  agentStatus: AgentStatusKey;
  eventsCount: number;
  events: TrapEvent[];
  createdAt: string;
}

export interface TrapAgent {
  id: string;
  name: string;
  host: string;
  version: string;
  uptime: string;
}

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
