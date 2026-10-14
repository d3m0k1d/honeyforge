// Auto-generated from the OpenAPI spec of HoneypotForge API (localhost:8000/openapi.json).
// Do not edit by hand — regenerate when the backend spec changes.

export interface AgentConfigRead {
  version: number;
  log: AgentLog;
  services: AgentService[];
  masking?: AgentMasking | null;
  honeytokens?: AgentHoneytoken[];
}

export interface AgentConfigWrite {
  version?: number | null;
  log?: AgentLog;
  services: AgentService[];
  masking?: AgentMasking | null;
  honeytokens?: AgentHoneytoken[];
}

export interface AgentEnroll {
  token: string;
}

export interface AgentEventBatch {
  events: AgentEventRead[];
}

export interface AgentEventRead {
  id: string;
  ts: string;
  service: string;
  level?: string | null;
  src?: string | null;
  event: string;
  rule?: string | null;
  data?: Record<string, string> | null;
}

export interface AgentHeartbeatRead {
  agent_id: string;
  last_heartbeat_at: string;
}

export interface AgentHoneytoken {
  id: number;
  name: string;
  file_name: string;
  target_path: string;
  content_type: string;
  encoding: string;
  content: string;
  checksum_sha256: string;
}

export interface AgentLog {
  output?: string;
}

export interface AgentMasking {
  endpoint_path?: string;
  beacon_interval_seconds?: number;
  jitter_seconds?: number;
  padding_bytes?: number;
  mgmt_interface?: string | null;
}

export interface AgentRead {
  agent_id: string;
  created_at: string;
  enrolled_at: string | null;
  last_heartbeat_at: string | null;
  online: boolean;
  profile_id?: string | null;
  profile_name?: string | null;
}

export interface AgentService {
  type: string;
  name?: string;
  level?: string;
  listen?: string;
  tls_cert?: string;
  tls_key?: string;
  max_conns?: number;
  idle_timeout?: number | string;
  delay?: number | string;
  jitter?: number | string;
  initial_delay?: number | string;
  log_input?: boolean | null;
  params?: Record<string, string>;
  greeting?: string;
  rules?: ServiceRule[];
}

export interface AlertRead {
  id: string;
  rule_id: string;
  rule_name: string;
  agent_id: string;
  source: string | null;
  event_count: number;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface AlertRuleCreate {
  name: string;
  enabled?: boolean;
  event: string;
  service?: string | null;
  threshold: number;
  window_seconds?: number;
}

export interface AlertRuleRead {
  name: string;
  enabled?: boolean;
  event: string;
  service?: string | null;
  threshold: number;
  window_seconds?: number;
  id: string;
  created_by_id: number | null;
  created_at: string;
}

export type ArtifactKind = "shell" | "ansible";

export interface ArtifactRead {
  id: string;
  name: string;
  kind: ArtifactKind;
  entrypoint: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: string;
}

export interface AuditLogRead {
  id: number;
  user_id: number | null;
  method: string;
  path: string;
  status_code: number;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Body_upload_deployment_artifact_deployment_artifacts_post {
  kind: ArtifactKind;
  entrypoint: string;
  file: string;
}

export interface CommandClaim {
  lease_seconds?: number;
}

export interface CommandRead {
  id: string;
  deployment_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: CommandStatus;
  generation: number;
  attempts: number;
  lease_until: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface CommandResult {
  status: CommandStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  snapshot_path?: string | null;
  snapshot_size_bytes?: number | null;
  snapshot_checksum_sha256?: string | null;
}

export type CommandStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";

export type DeploymentAction = "start" | "stop" | "destroy" | "reconcile";

export interface DeploymentActionRequest {
  action: DeploymentAction;
}

export interface DeploymentCreate {
  name: string;
  agent_id: string;
  honeypot_type: string;
  config?: Record<string, unknown>;
}

export interface DeploymentRead {
  id: string;
  name: string;
  agent_id: string;
  honeypot_type: string;
  definition_version: number;
  level: string;
  driver: string;
  config: Record<string, unknown>;
  desired_state: string;
  observed_state: string;
  generation: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrollmentTokenCreate {
  agent_id: string;
  expires_in_minutes?: number;
}

export interface EnrollmentTokenRead {
  agent_id: string;
  token: string;
  expires_at: string;
}

export interface EventRead {
  id: number;
  event_id: string;
  agent_id: string;
  ts: string;
  service: string;
  level: string | null;
  src: string | null;
  event: string;
  rule: string | null;
  data: Record<string, unknown> | null;
  geo?: string | null;
  asn?: string | null;
}

export interface EventStats {
  total: number;
  by_event: Record<string, number>;
  by_service: Record<string, number>;
  top_sources: Record<string, number>;
  generated_at: string;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

export interface HoneytokenCreate {
  name: string;
  description?: string | null;
  file_name: string;
  target_path: string;
  file_type?: HoneytokenFileType;
  content_type?: string;
  encoding?: string;
  content: string;
  is_active?: boolean;
}

export interface HoneytokenDetail {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  file_name: string;
  target_path: string;
  file_type: HoneytokenFileType;
  content_type: string;
  encoding: string;
  checksum_sha256: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  content: string;
}

export type HoneytokenFileType = "env" | "json" | "yaml" | "toml" | "ini" | "plain";

export interface HoneytokenRead {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  file_name: string;
  target_path: string;
  file_type: HoneytokenFileType;
  content_type: string;
  encoding: string;
  checksum_sha256: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type PermissionName = "users:read" | "users:manage" | "roles:read" | "roles:manage" | "honeypots:read" | "honeypots:manage" | "honeytokens:read" | "honeytokens:manage" | "agents:read" | "agents:manage" | "deployments:read" | "deployments:manage" | "profiles:read" | "profiles:manage" | "events:read" | "audit:read" | "alerts:read" | "alerts:manage";

export interface ProfileCreate {
  name: string;
  description?: string | null;
  level: "low" | "medium";
  services: AgentService[];
  logging?: AgentLog;
  masking?: AgentMasking;
  honeytoken_ids?: number[];
}

export interface ProfileRead {
  name: string;
  description?: string | null;
  level: "low" | "medium";
  services: AgentService[];
  logging?: AgentLog;
  masking?: AgentMasking;
  honeytoken_ids?: number[];
  id: string;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdate {
  name: string;
  description?: string | null;
  level: "low" | "medium";
  services: AgentService[];
  logging?: AgentLog;
  masking?: AgentMasking;
  honeytoken_ids?: number[];
}

export interface ResetRequest {
  preserve_incident?: boolean;
}

export type RoleName = "admin" | "operator" | "viewer";

export interface RoleRead {
  name: RoleName;
  permissions: PermissionName[];
}

export interface ServiceRule {
  name?: string;
  pattern?: string;
  response?: string;
  delay?: number | string;
  jitter?: number | string;
  capture?: string[];
  on?: string;
  set_state?: string;
  clear_state?: boolean;
  once?: boolean;
  close?: boolean;
}

export interface SnapshotCreate {
  type?: string;
}

export interface SnapshotRead {
  id: string;
  deployment_id: string;
  type: string;
  state: string;
  path: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  error: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
}

export interface UserCreate {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

export interface UserRead {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: string;
  roles: RoleRead[];
}

export interface UserRolesUpdate {
  roles: RoleName[];
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}
