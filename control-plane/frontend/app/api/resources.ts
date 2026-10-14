import {
  cachedGet,
  del,
  http,
  post,
  put,
} from "./http";
import type { CachePolicy } from "./cache";
import type {
  AgentConfigRead,
  AgentConfigWrite,
  AgentEventRead,
  AgentRead,
  AlertRead,
  AlertRuleCreate,
  AlertRuleRead,
  AuditLogRead,
  CommandRead,
  DeploymentAction,
  DeploymentCreate,
  DeploymentRead,
  EventRead,
  EventStats,
  HoneytokenCreate,
  HoneytokenDetail,
  HoneytokenRead,
  ProfileCreate,
  ProfileRead,
  ProfileUpdate,
  ResetRequest,
  SnapshotCreate,
  SnapshotRead,
} from "~/types/api";

/** Свободная схема каталога типов ловушек (backend отдаёт object с любыми полями). */
export type HoneypotType = Record<string, unknown>;

type CacheOpts = { cache?: CachePolicy };

const LIST_CACHE = {
  ttl: 30_000,
  staleTtl: 2 * 60_000,
  persist: true,
} as const;

const CATALOG_CACHE = {
  ttl: 10 * 60_000,
  staleTtl: 10 * 60_000,
  persist: true,
} as const;

export interface PageQuery {
  offset?: number;
  limit?: number;
}

export interface EventsQuery extends PageQuery {
  agent_id?: string;
  since?: string;
  until?: string;
  src?: string;
  event?: string;
  service?: string;
}

export interface AgentEventsQuery extends PageQuery {
  since?: string;
  until?: string;
  src?: string;
  event?: string;
}

export interface HoneytokensQuery extends PageQuery {
  active?: boolean;
}

export interface AuditQuery extends PageQuery {
  user_id?: number;
  since?: string;
}

/**
 * Типизированные обёртки над остальными эндпоинтами HoneypotForge API.
 * GET-списки идут через кэш (TTL + localStorage + dedupe).
 */
export const resources = {
  agents: {
    list: (options: CacheOpts = {}) =>
      cachedGet<AgentRead[]>("/agents", { ...options, cache: { ...LIST_CACHE, tags: ["agents"], ...options.cache } }),

    config: (agentId: string, options: CacheOpts = {}) =>
      cachedGet<AgentConfigRead>(`/agents/${agentId}/config`, {
        ...options,
        cache: { ttl: 30_000, staleTtl: 60_000, tags: ["agents"], ...options.cache },
      }),

    assignConfig: (agentId: string, data: AgentConfigWrite) =>
      put<AgentConfigRead>(`/agents/${agentId}/config`, data, { invalidate: ["agents"] }),

    events: (agentId: string, query: AgentEventsQuery = {}, options: CacheOpts = {}) =>
      cachedGet<AgentEventRead[]>(`/agents/${agentId}/events`, {
        params: query,
        ...options,
        cache: { ttl: 15_000, staleTtl: 60_000, tags: ["agents", "events"], ...options.cache },
      }),
  },

  honeypotTypes: {
    list: (options: CacheOpts = {}) =>
      cachedGet<HoneypotType[]>("/honeypot-types", {
        ...options,
        cache: { ...CATALOG_CACHE, tags: ["honeypot-types"], ...options.cache },
      }),
  },

  deployments: {
    list: (query: PageQuery = {}, options: CacheOpts = {}) =>
      cachedGet<DeploymentRead[]>("/deployments", {
        params: query,
        ...options,
        cache: { ...LIST_CACHE, tags: ["deployments"], ...options.cache },
      }),

    get: (deploymentId: string, options: CacheOpts = {}) =>
      cachedGet<DeploymentRead>(`/deployments/${deploymentId}`, {
        ...options,
        cache: { ttl: 15_000, staleTtl: 60_000, tags: ["deployments"], ...options.cache },
      }),

    create: (data: DeploymentCreate) =>
      post<DeploymentRead>("/deployments", data, { invalidate: ["deployments"] }),

    action: (deploymentId: string, action: DeploymentAction) =>
      post<DeploymentRead>(`/deployments/${deploymentId}/actions`, { action }, {
        invalidate: ["deployments"],
      }),

    reset: (deploymentId: string, data: ResetRequest = {}) =>
      post<DeploymentRead>(`/deployments/${deploymentId}/reset`, data, {
        invalidate: ["deployments", "events"],
      }),

    snapshots: (deploymentId: string, options: CacheOpts = {}) =>
      cachedGet<SnapshotRead[]>(`/deployments/${deploymentId}/snapshots`, {
        ...options,
        cache: { ttl: 15_000, staleTtl: 60_000, tags: ["deployments"], ...options.cache },
      }),

    createSnapshot: (deploymentId: string, data: SnapshotCreate) =>
      post<SnapshotRead>(`/deployments/${deploymentId}/snapshots`, data, {
        invalidate: ["deployments"],
      }),

    commands: (deploymentId: string, options: CacheOpts = {}) =>
      cachedGet<CommandRead[]>(`/deployments/${deploymentId}/commands`, {
        ...options,
        cache: { ttl: 10_000, staleTtl: 30_000, tags: ["deployments", "commands"], swr: false, ...options.cache },
      }),
  },

  profiles: {
    list: (options: CacheOpts = {}) =>
      cachedGet<ProfileRead[]>("/profiles", { ...options, cache: { ...LIST_CACHE, tags: ["profiles"], ...options.cache } }),

    get: (profileId: string, options: CacheOpts = {}) =>
      cachedGet<ProfileRead>(`/profiles/${profileId}`, {
        ...options,
        cache: { ttl: 30_000, staleTtl: 2 * 60_000, tags: ["profiles"], ...options.cache },
      }),

    create: (data: ProfileCreate) =>
      post<ProfileRead>("/profiles", data, { invalidate: ["profiles"] }),

    update: (profileId: string, data: ProfileUpdate) =>
      put<ProfileRead>(`/profiles/${profileId}`, data, { invalidate: ["profiles"] }),

    remove: (profileId: string) =>
      del(`/profiles/${profileId}`, { invalidate: ["profiles"] }),

    assignAgent: (profileId: string, agentId: string) =>
      put<AgentConfigRead>(`/profiles/${profileId}/agents/${agentId}`, undefined, {
        invalidate: ["profiles", "agents"],
      }),
  },

  events: {
    list: (query: EventsQuery = {}, options: CacheOpts = {}) =>
      cachedGet<EventRead[]>("/events", {
        params: query,
        ...options,
        cache: { ttl: 15_000, staleTtl: 60_000, tags: ["events"], ...options.cache },
      }),

    stats: (query: Omit<EventsQuery, "limit" | "offset"> = {}, options: CacheOpts = {}) =>
      cachedGet<EventStats>("/events/stats", {
        params: query,
        ...options,
        cache: { ttl: 30_000, staleTtl: 2 * 60_000, tags: ["events"], ...options.cache },
      }),

    /** CSV-экспорт отдаётся файлом — грузим напрямую через инстанс. */
    exportCsv: () => http().get("/events/export.csv", { responseType: "blob" }),

    /** STIX-экспорт (JSON). */
    exportStix: () => cachedGet<Record<string, unknown>>("/events/export.stix", {
      cache: { ttl: 60_000, tags: ["events"] },
    }),
  },

  honeytokens: {
    list: (query: HoneytokensQuery = {}, options: CacheOpts = {}) =>
      cachedGet<HoneytokenRead[]>("/honeytokens", {
        params: query,
        ...options,
        cache: { ...LIST_CACHE, tags: ["honeytokens"], ...options.cache },
      }),

    get: (honeytokenId: number, options: CacheOpts = {}) =>
      cachedGet<HoneytokenDetail>(`/honeytokens/${honeytokenId}`, {
        ...options,
        cache: { ttl: 30_000, staleTtl: 2 * 60_000, tags: ["honeytokens"], ...options.cache },
      }),

    create: (data: HoneytokenCreate) =>
      post<HoneytokenDetail>("/honeytokens", data, { invalidate: ["honeytokens"] }),

    update: (honeytokenId: number, data: HoneytokenCreate) =>
      put<HoneytokenDetail>(`/honeytokens/${honeytokenId}`, data, {
        invalidate: ["honeytokens"],
      }),

    remove: (honeytokenId: number) =>
      del(`/honeytokens/${honeytokenId}`, { invalidate: ["honeytokens"] }),
  },

  alerts: {
    list: (query: { acknowledged?: boolean } = {}, options: CacheOpts = {}) =>
      cachedGet<AlertRead[]>("/alerts", {
        params: query,
        ...options,
        cache: { ttl: 15_000, staleTtl: 60_000, tags: ["alerts"], ...options.cache },
      }),

    acknowledge: (alertId: string) =>
      post<AlertRead>(`/alerts/${alertId}/acknowledge`, undefined, {
        invalidate: ["alerts"],
      }),

    rules: (options: CacheOpts = {}) =>
      cachedGet<AlertRuleRead[]>("/alerts/rules", {
        ...options,
        cache: { ttl: 60_000, staleTtl: 5 * 60_000, tags: ["alerts"], ...options.cache },
      }),

    createRule: (data: AlertRuleCreate) =>
      post<AlertRuleRead>("/alerts/rules", data, { invalidate: ["alerts"] }),

    updateRule: (ruleId: string, data: AlertRuleCreate) =>
      put<AlertRuleRead>(`/alerts/rules/${ruleId}`, data, { invalidate: ["alerts"] }),

    removeRule: (ruleId: string) =>
      del(`/alerts/rules/${ruleId}`, { invalidate: ["alerts"] }),
  },

  audit: {
    list: (query: AuditQuery = {}, options: CacheOpts = {}) =>
      cachedGet<AuditLogRead[]>("/audit", {
        params: query,
        ...options,
        cache: { ttl: 30_000, staleTtl: 2 * 60_000, tags: ["audit"], ...options.cache },
      }),
  },

  health: (options: CacheOpts = {}) =>
    cachedGet<Record<string, string>>("/health", {
      ...options,
      cache: { ttl: 10_000, staleTtl: 10_000, tags: ["health"], swr: false, ...options.cache },
    }),
};
