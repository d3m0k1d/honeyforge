import { defineStore } from "pinia";
import type {
  ServiceKey,
  DeploymentTrap as Trap,
  TrapFieldKey,
  TrapLevel,
  TrapSort,
} from "~/types/traps";
import {
  LEVEL_BY_KEY,
  TRAP_FIELDS,
} from "~/utils/traps";
import { resources } from "~/api/resources";
import { toApiError } from "~/api/errors";
import { clearCache } from "~/api/cache";
import type { DeploymentCreate, DeploymentRead, DeploymentAction } from "~/types/api";
import type { TrapProfile } from "~/types/traps";

const FIELDS_KEY = "honeypotforge:trap-fields";

function isClient() {
  return import.meta.client;
}

function readJson<T>(key: string, fallback: T): T {
  if (!isClient()) return fallback;

  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;

    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!isClient()) return;

  localStorage.setItem(key, JSON.stringify(value));
}

function defaultVisibility(): Record<TrapFieldKey, boolean> {
  return TRAP_FIELDS.reduce(
    (acc, field) => {
      acc[field.key] = field.defaultVisible;
      return acc;
    },
    {} as Record<TrapFieldKey, boolean>,
  );
}

function levelWeight(level: TrapLevel) {
  if (level === "high") return 3;
  if (level === "medium") return 2;

  return 1;
}

function compare(a: Trap, b: Trap, field: TrapSort["field"]) {
  switch (field) {
    case "profile":
      return a.profileId.localeCompare(b.profileId, "ru");
    case "port":
      return (a.services[0]?.port ?? 0) - (b.services[0]?.port ?? 0);
    case "level":
      return levelWeight(a.level) - levelWeight(b.level);
    case "agent":
      return a.agentId.localeCompare(b.agentId, "ru");
    case "events":
      return (a.eventsCount ?? 0) - (b.eventsCount ?? 0);
    case "createdAt":
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    case "services":
      return a.services.length - b.services.length;
    default:
      return a.name.localeCompare(b.name, "ru");
  }
}

export type CreateTrapInput = DeploymentCreate;

export const useTrapsStore = defineStore("traps", () => {
  const auth = useAuthStore();
  const agentsStore = useAgentsStore();
  const traps = ref<Trap[]>([]);
  const profiles = ref<TrapProfile[]>([]);
  const pending = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const catalogueError = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const actionPending = ref<string | null>(null);
  const canManage = computed(() => auth.can("deployments:read") && auth.can("deployments:manage"));
  const fieldVisibility = ref<Record<TrapFieldKey, boolean>>(
    defaultVisibility(),
  );
  const serviceVisibility = ref<Record<string, boolean>>({
    ssh: true,
    http: true,
    smtp: true,
    redis: true,
    tcp: true,
    postgresql: true,
    mysql: true,
  });

  const search = ref("");
  const levelFilter = ref<"all" | TrapLevel>("all");
  const agentFilter = ref<"all" | Trap["agentStatus"]>("all");
  const sort = ref<TrapSort>({ field: "createdAt", direction: "desc" });
  const pendingDeleteId = ref<string | null>(null);

  const visibleFields = computed(() =>
    TRAP_FIELDS.filter((field) => fieldVisibility.value[field.key]),
  );

  const isFieldVisible = computed(() => (key: TrapFieldKey) => fieldVisibility.value[key]);

  const hiddenFieldsCount = computed(
    () =>
      TRAP_FIELDS.filter((field) => !fieldVisibility.value[field.key]).length,
  );

  const trapsByProfile = computed(
    () =>
      profiles.value.map((profile) => ({
        profile,
        count: loaded.value ? traps.value.filter((trap) => trap.profileId === profile.id).length : null,
      })),
  );

  const filteredTraps = computed(() => {
    const query = search.value.trim().toLowerCase();
    const level = levelFilter.value;
    const status = agentFilter.value;

    const list = traps.value.filter((trap) => {
      if (level !== "all" && trap.level !== level) return false;
      if (status !== "all" && trap.agentStatus !== status) return false;

      if (!query) return true;

      const profile = profiles.value.find((item) => item.id === trap.profileId);
      const haystack = [
        trap.name,
        trap.id,
        trap.description,
        profile?.name ?? "",
        trap.agentId,
        ...trap.services.map((service) => `${service.key} ${service.port}`),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });

    const direction = sort.value.direction === "asc" ? 1 : -1;

    return [...list].sort((a, b) => compare(a, b, sort.value.field) * direction);
  });

  const deletingTrap = computed(
    () => traps.value.find((trap) => trap.id === pendingDeleteId.value) ?? null,
  );

  const totalEvents = computed(() => null);

  const onlineCount = computed(
    () => agentsStore.onlineCount,
  );

  function mapDeployment(item: DeploymentRead): Trap {
    const listen = typeof item.config.listen === "string" ? item.config.listen : "";
    const port = Number(listen.split(":").pop());
    const agent = agentsStore.agents.find((entry) => entry.agent_id === item.agent_id);
    return {
      id: item.id, name: item.name, profileId: item.honeypot_type,
      description: item.last_error ?? "",
      services: item.level === "high" ? [] : [{
        key: item.honeypot_type.replace(/-(low|mid)$/, ""),
        port: listen.includes(":") && Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
      }],
      level: item.level as TrapLevel,
      agentId: item.agent_id,
      agentStatus: agent ? (agent.online ? "online" : "offline") : "unknown",
      eventsCount: null, events: [], createdAt: item.created_at,
      desiredState: item.desired_state, observedState: item.observed_state, lastError: item.last_error,
    };
  }

  let inflight: Promise<void> | null = null;
  let generation = 0;
  watch(() => [auth.user, auth.can("deployments:read"), auth.can("deployments:manage"), auth.can("agents:read")], () => {
    generation++;
    // Forced GETs still deduplicate across callers unless the shared cache is cleared.
    clearCache();
    inflight = null;
    traps.value = [];
    profiles.value = [];
    pending.value = false;
    loaded.value = false;
    error.value = null;
    catalogueError.value = null;
    actionError.value = null;
    actionPending.value = null;
    pendingDeleteId.value = null;
  }, { flush: "sync" });

  async function loadCatalogue() {
    const request = generation;
    profiles.value = [];
    catalogueError.value = null;
    if (!auth.can("deployments:read")) {
      catalogueError.value = "Нет права deployments:read";
      return;
    }
    try {
      const items = await resources.honeypotTypes.list({ cache: { force: true, swr: false, persist: false } });
      if (request !== generation) return;
      profiles.value = items.filter((item) => typeof item.slug === "string").map((item) => ({
        id: String(item.slug), name: String(item.name ?? item.slug),
        description: typeof item.description === "string" ? item.description : String(item.driver ?? ""),
        icon: "i-lucide-radar", level: item.level as TrapLevel,
        tags: [String(item.driver ?? "")], services: [],
        configSchema: item.config_schema as Record<string, unknown> | undefined,
      }));
    } catch (err) {
      if (request !== generation) return;
      profiles.value = [];
      catalogueError.value = toApiError(err).message;
    }
  }

  function load(): Promise<void> {
    if (inflight) return inflight;
    fieldVisibility.value = {
      ...defaultVisibility(),
      ...readJson<Partial<Record<TrapFieldKey, boolean>>>(FIELDS_KEY, {}),
    };
    traps.value = [];
    error.value = null;
    loaded.value = false;
    pending.value = true;
    const request = generation;
    inflight = (async () => {
      try {
        await Promise.all([loadCatalogue(), agentsStore.load()]);
        if (request !== generation) return;
        if (!auth.can("deployments:read")) {
          error.value = "Нет права deployments:read";
          return;
        }
        const rows: DeploymentRead[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await resources.deployments.list({ offset, limit: 100 }, { cache: { force: true, swr: false, persist: false } });
          if (request !== generation) return;
          rows.push(...page);
          if (page.length < 100) break;
        }
        traps.value = rows.map(mapDeployment);
        loaded.value = true;
      } catch (err) {
        if (request !== generation) return;
        traps.value = [];
        error.value = toApiError(err).message;
      } finally {
        if (request === generation) {
          pending.value = false;
          inflight = null;
        }
      }
    })();
    return inflight;
  }

  function persist() {
    writeJson(FIELDS_KEY, fieldVisibility.value);
  }

  function getTrap(id: string | null) {
    if (!id) return null;

    return traps.value.find((trap) => trap.id === id) ?? null;
  }

  function setSearch(value: string) {
    search.value = value;
  }

  function setLevelFilter(value: "all" | TrapLevel) {
    levelFilter.value = value;
  }

  function setAgentFilter(value: "all" | Trap["agentStatus"]) {
    agentFilter.value = value;
  }

  function setSort(next: TrapSort) {
    sort.value = next;
  }

  function toggleSort(field: TrapSort["field"]) {
    if (sort.value.field === field) {
      sort.value = {
        field,
        direction: sort.value.direction === "asc" ? "desc" : "asc",
      };
      return;
    }

    sort.value = {
      field,
      direction: field === "name" || field === "profile" ? "asc" : "desc",
    };
  }

  function toggleField(key: TrapFieldKey) {
    const field = TRAP_FIELDS.find((item) => item.key === key);

    if (!field || field.locked) return;

    fieldVisibility.value[key] = !fieldVisibility.value[key];
    persist();
  }

  function setFieldVisibility(visible: TrapFieldKey[]) {
    for (const field of TRAP_FIELDS) {
      if (field.locked) continue;

      fieldVisibility.value[field.key] = visible.includes(field.key);
    }

    persist();
  }

  function resetFields() {
    fieldVisibility.value = defaultVisibility();
    persist();
  }

  function setServiceVisibility(key: ServiceKey, visible: boolean) {
    serviceVisibility.value[key] = visible;
  }

  function toggleServiceVisibility(key: ServiceKey) {
    serviceVisibility.value[key] = !serviceVisibility.value[key];
  }

  async function createTrap(input: CreateTrapInput) {
    if (!canManage.value) {
      actionError.value = "Нужны права deployments:read и deployments:manage";
      return null;
    }
    if (actionPending.value) return null;
    const request = generation;
    actionPending.value = "create";
    actionError.value = null;
    try {
      const row = await resources.deployments.create(input);
      if (request !== generation) return null;
      const created = mapDeployment(row);
      traps.value = [created, ...traps.value];
      return created;
    } catch (err) {
      if (request !== generation) return null;
      actionError.value = toApiError(err).message;
      return null;
    } finally {
      if (request === generation) actionPending.value = null;
    }
  }

  async function runAction(id: string, action: DeploymentAction) {
    if (!canManage.value) {
      actionError.value = "Нужны права deployments:read и deployments:manage";
      return null;
    }
    if (actionPending.value) return null;
    const request = generation;
    actionPending.value = id;
    actionError.value = null;
    try {
      const row = await resources.deployments.action(id, action);
      if (request !== generation) return null;
      const updated = mapDeployment(row);
      traps.value = traps.value.map((trap) => trap.id === id ? updated : trap);
      return updated;
    } catch (err) {
      if (request !== generation) return null;
      actionError.value = toApiError(err).message;
      return null;
    } finally {
      if (request === generation) actionPending.value = null;
    }
  }

  function requestDelete(id: string) {
    if (!canManage.value) return;
    actionError.value = null;
    pendingDeleteId.value = id;
  }
  function cancelDelete() {
    pendingDeleteId.value = null;
  }

  async function confirmDelete() {
    if (!pendingDeleteId.value) return null;

    const request = generation;
    const updated = await runAction(pendingDeleteId.value, "destroy");
    if (request !== generation) return null;
    if (updated) pendingDeleteId.value = null;
    return updated;
  }

  function levelInfo(level: TrapLevel) {
    return LEVEL_BY_KEY[level];
  }

  return {
    traps,
    profiles,
    pending,
    loaded,
    error,
    catalogueError,
    actionError,
    actionPending,
    canManage,
    loadCatalogue,
    runAction,
    fieldVisibility,
    serviceVisibility,
    search,
    levelFilter,
    agentFilter,
    sort,
    pendingDeleteId,
    visibleFields,
    isFieldVisible,
    hiddenFieldsCount,
    trapsByProfile,
    filteredTraps,
    deletingTrap,
    totalEvents,
    onlineCount,
    load,
    persist,
    getTrap,
    setSearch,
    setLevelFilter,
    setAgentFilter,
    setSort,
    toggleSort,
    toggleField,
    setFieldVisibility,
    resetFields,
    setServiceVisibility,
    toggleServiceVisibility,
    createTrap,
    requestDelete,
    cancelDelete,
    confirmDelete,
    levelInfo,
  };
});
