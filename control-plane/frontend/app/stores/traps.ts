import { defineStore } from "pinia";
import type {
  AgentRead,
  DeploymentAction,
  DeploymentCreate,
  DeploymentRead,
  EventRead,
  ProfileRead,
  QEMUImageRead,
} from "~/types/api";
import { resources } from "~/api/resources";
import { toApiError } from "~/api/errors";
import type {
  ServiceKey,
  Trap,
  TrapEvent,
  TrapFieldKey,
  TrapLevel,
  TrapProfile,
  TrapService,
  TrapSort,
} from "~/types/traps";
import {
  TRAP_FIELDS,
  catalogTypeFor,
  deriveAgentStatus,
  displayServiceKey,
  mapEvent,
  parseListenPort,
  profileToTrapProfile,
  serviceMeta,
} from "~/utils/traps";

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

export interface CreateTrapInput {
  name: string;
  level: TrapLevel;
  agentId: string;
  services: TrapService[];
  /** Образ QEMU (только для уровня high). */
  image?: string;
}

export const useTrapsStore = defineStore("traps", () => {
  const traps = ref<Trap[]>([]);
  const profiles = ref<ProfileRead[]>([]);
  const agents = ref<AgentRead[]>([]);
  const catalogSlugs = ref<string[]>([]);
  const qemuImages = ref<QEMUImageRead[]>([]);
  const eventsTotal = ref<number | null>(null);

  const loading = ref(false);
  const pending = ref(false);
  const error = ref<string | null>(null);

  const fieldVisibility = ref<Record<TrapFieldKey, boolean>>(defaultVisibility());
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
  const sort = ref<TrapSort>({ field: "events", direction: "desc" });
  const pendingDeleteId = ref<string | null>(null);

  const deploymentsRaw = ref<DeploymentRead[]>([]);
  /** События по агентам: agent_id → EventRead[] (последняя загрузка). */
  let eventsByAgent = new Map<string, EventRead[]>();
  let loaded = false;

  const profilesById = computed(() => {
    const map: Record<string, ProfileRead> = {};

    for (const profile of profiles.value) map[profile.id] = profile;

    return map;
  });

  const agentsById = computed(() => {
    const map: Record<string, AgentRead> = {};

    for (const agent of agents.value) map[agent.agent_id] = agent;

    return map;
  });

  const enrolledAgents = computed(() =>
    agents.value.filter((agent) => agent.enrolled_at),
  );

  const profileViews = computed(() => profiles.value.map(profileToTrapProfile));

  const profileNameById = computed(() => {
    const map: Record<string, string> = {};

    for (const view of profileViews.value) map[view.id] = view.name;

    return map;
  });

  const profileIconById = computed(() => {
    const map: Record<string, string> = {};

    for (const view of profileViews.value) map[view.id] = view.icon;

    return map;
  });

  const profileCards = computed(() =>
    profileViews.value.map((profile) => ({
      profile,
      count: traps.value.filter((trap) => trap.profileId === profile.id).length,
    })),
  );

  const visibleFields = computed(() =>
    TRAP_FIELDS.filter((field) => fieldVisibility.value[field.key]),
  );

  const hiddenFieldsCount = computed(
    () => TRAP_FIELDS.filter((field) => !fieldVisibility.value[field.key]).length,
  );

  const onlineCount = computed(
    () => agents.value.filter((agent) => agent.online).length,
  );

  const totalEvents = computed(() =>
    eventsTotal.value ??
    traps.value.reduce((sum, trap) => sum + trap.eventsCount, 0),
  );

  const hasQemuImageType = computed(() =>
    catalogSlugs.value.includes("qemu-high"),
  );

  function mapDeployment(deployment: DeploymentRead): Trap {
    const agent = agentsById.value[deployment.agent_id];
    const profileId = agent?.profile_id ?? "";
    const profile = profileId ? profilesById.value[profileId] : undefined;

    const isHigh = deployment.honeypot_type === "qemu-high";
    const base = deployment.honeypot_type.replace(/-(low|mid|high)$/, "");
    const services: TrapService[] = [];

    if (!isHigh) {
      const key = displayServiceKey(base);
      const listen =
        typeof deployment.config.listen === "string"
          ? deployment.config.listen
          : null;

      services.push({
        key,
        port: parseListenPort(listen) ?? serviceMeta(key).defaultPort,
      });
    }

    const raw = eventsByAgent.get(deployment.agent_id) ?? [];
    const keys = new Set(services.map((service) => service.key));
    const portByKey = new Map(
      services.map((service) => [service.key, service.port]),
    );
    // для мультисервисного агента события режем по сервису, для high — все
    const matched = keys.size
      ? raw.filter((event) => keys.has(displayServiceKey(event.service)))
      : raw;

    const events: TrapEvent[] = matched.map((event) =>
      mapEvent(event, {
        trapId: deployment.id,
        port: portByKey.get(displayServiceKey(event.service)) ?? 0,
      }),
    );

    return {
      id: deployment.id,
      name: deployment.name,
      profileId,
      description: profile?.description?.trim() || "",
      services,
      level: (deployment.level as TrapLevel) || "low",
      agentId: deployment.agent_id,
      agentStatus: deriveAgentStatus(deployment, agent),
      honeypotType: deployment.honeypot_type,
      driver: deployment.driver,
      desiredState: deployment.desired_state,
      observedState: deployment.observed_state,
      lastError: deployment.last_error,
      eventsCount: events.length,
      events,
      createdAt: deployment.created_at,
    };
  }

  function rebuild() {
    traps.value = deploymentsRaw.value
      .filter((deployment) => deployment.desired_state !== "deleted")
      .map(mapDeployment);
  }

  async function load(force = false): Promise<void> {
    if (loading.value || (!force && loaded)) return;

    loading.value = true;
    error.value = null;

    try {
      const [deployments, agentList, profileList, types, stats] =
        await Promise.all([
          resources.deployments.list({ limit: 100 }, { cache: { force } }),
          resources.agents.list({ cache: { force } }),
          resources.profiles.list({ cache: { force } }),
          resources.honeypotTypes.list({ cache: { force } }),
          resources.events
            .stats({}, { cache: { force } })
            .catch(() => null),
        ]);

      const agentIds = agentList
        .filter((agent) => agent.enrolled_at)
        .map((agent) => agent.agent_id);

      const eventLists = await Promise.all(
        agentIds.map((agentId) =>
          resources.events
            .list(
              { agent_id: agentId, limit: 1000 },
              { cache: { ttl: 15_000, staleTtl: 60_000, tags: ["events"], force } },
            )
            .catch(() => [] as EventRead[]),
        ),
      );

      eventsByAgent = new Map();
      agentIds.forEach((agentId, index) => {
        eventsByAgent.set(agentId, eventLists[index] ?? []);
      });

      deploymentsRaw.value = deployments;
      profiles.value = profileList;
      agents.value = agentList;
      catalogSlugs.value = types
        .map((type) => String(type.slug ?? ""))
        .filter(Boolean);
      eventsTotal.value = stats?.total ?? null;
      rebuild();
      loaded = true;
    } catch (err) {
      error.value = toApiError(err).message;
    } finally {
      loading.value = false;
    }
  }

  /** Свежий список deployments (после мутаций). */
  async function refreshDeployments(): Promise<void> {
    const deployments = await resources.deployments.list(
      { limit: 100 },
      { cache: { force: true } },
    );

    deploymentsRaw.value = deployments;
    rebuild();
  }

  function upsertDeployment(deployment: DeploymentRead) {
    const list = [...deploymentsRaw.value];
    const index = list.findIndex((item) => item.id === deployment.id);

    if (index === -1) list.unshift(deployment);
    else list[index] = deployment;

    deploymentsRaw.value = list;
    rebuild();
  }

  async function runAction(
    id: string,
    action: DeploymentAction,
  ): Promise<DeploymentRead | null> {
    pending.value = true;
    error.value = null;

    try {
      const updated = await resources.deployments.action(id, action);
      upsertDeployment(updated);

      return updated;
    } catch (err) {
      error.value = toApiError(err).message;
      return null;
    } finally {
      pending.value = false;
    }
  }

  /** Создание: low/medium — по одному deployment на сервис, high — одна VM. */
  async function createTraps(input: CreateTrapInput): Promise<Trap[]> {
    const name = input.name.trim();
    const payloads: DeploymentCreate[] = [];

    if (input.level === "high") {
      payloads.push({
        name,
        agent_id: input.agentId,
        honeypot_type: "qemu-high",
        config: { image: input.image },
      });
    } else {
      const many = input.services.length > 1;

      for (const service of input.services) {
        const slug = catalogTypeFor(service.key, input.level);
        if (!slug) continue;

        payloads.push({
          name: many
            ? `${name}-${serviceMeta(service.key).short.toLowerCase()}`
            : name,
          agent_id: input.agentId,
          honeypot_type: slug,
          config: { listen: `:${service.port}` },
        });
      }
    }

    if (!payloads.length) return [];

    pending.value = true;
    error.value = null;

    const created: DeploymentRead[] = [];

    try {
      for (const payload of payloads) {
        created.push(await resources.deployments.create(payload));
      }

      if (created.length) {
        const ids = new Set(created.map((item) => item.id));

        deploymentsRaw.value = [
          ...created,
          ...deploymentsRaw.value.filter((item) => !ids.has(item.id)),
        ];
        rebuild();
      }

      return created
        .map((item) => traps.value.find((trap) => trap.id === item.id))
        .filter((trap): trap is Trap => Boolean(trap));
    } catch (err) {
      error.value = toApiError(err).message;
      return [];
    } finally {
      pending.value = false;
    }
  }

  async function loadQemuImages(force = false): Promise<void> {
    try {
      qemuImages.value = await resources.qemuImages.list({
        cache: { force },
      });
    } catch {
      qemuImages.value = [];
    }
  }

  function isServiceAvailable(key: ServiceKey, level: TrapLevel = "medium") {
    if (level === "high") return hasQemuImageType.value;

    const slug = catalogTypeFor(key, level);

    return Boolean(slug && catalogSlugs.value.includes(slug));
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

  function compare(a: Trap, b: Trap, field: TrapSort["field"]) {
    switch (field) {
      case "profile":
        return (profileNameById.value[a.profileId] ?? "").localeCompare(
          profileNameById.value[b.profileId] ?? "",
          "ru",
        );
      case "port":
        return (a.services[0]?.port ?? 0) - (b.services[0]?.port ?? 0);
      case "level":
        return levelWeight(a.level) - levelWeight(b.level);
      case "agent":
        return (
          agentsById.value[a.agentId]?.agent_id ?? a.agentId
        ).localeCompare(agentsById.value[b.agentId]?.agent_id ?? b.agentId, "ru");
      case "events":
        return a.eventsCount - b.eventsCount;
      case "createdAt":
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      case "services":
        return a.services.length - b.services.length;
      default:
        return a.name.localeCompare(b.name, "ru");
    }
  }

  const filteredTraps = computed(() => {
    const query = search.value.trim().toLowerCase();
    const level = levelFilter.value;
    const status = agentFilter.value;

    const list = traps.value.filter((trap) => {
      if (level !== "all" && trap.level !== level) return false;
      if (status !== "all" && trap.agentStatus !== status) return false;

      if (!query) return true;

      const haystack = [
        trap.name,
        trap.id,
        trap.description,
        trap.honeypotType,
        profileNameById.value[trap.profileId] ?? "",
        agentsById.value[trap.agentId]?.agent_id ?? trap.agentId,
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
    () =>
      traps.value.find((trap) => trap.id === pendingDeleteId.value) ?? null,
  );

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

  function requestDelete(id: string) {
    pendingDeleteId.value = id;
  }

  function cancelDelete() {
    pendingDeleteId.value = null;
  }

  /** DESTROY на backend: при успехе ловушка исчезает из списка. */
  async function confirmDelete(): Promise<Trap | null> {
    const id = pendingDeleteId.value;
    if (!id) return null;

    const removed = getTrap(id);
    const result = await runAction(id, "destroy");

    if (!result) return null;

    pendingDeleteId.value = null;

    return removed;
  }

  function persist() {
    writeJson(FIELDS_KEY, fieldVisibility.value);
  }

  function restoreFields() {
    fieldVisibility.value = {
      ...defaultVisibility(),
      ...readJson<Partial<Record<TrapFieldKey, boolean>>>(FIELDS_KEY, {}),
    };
  }

  restoreFields();

  return {
    traps,
    profiles,
    agents,
    catalogSlugs,
    qemuImages,
    loading,
    pending,
    error,
    fieldVisibility,
    serviceVisibility,
    search,
    levelFilter,
    agentFilter,
    sort,
    pendingDeleteId,
    profilesById,
    agentsById,
    enrolledAgents,
    profileViews,
    profileCards,
    profileNameById,
    profileIconById,
    visibleFields,
    hiddenFieldsCount,
    onlineCount,
    totalEvents,
    hasQemuImageType,
    filteredTraps,
    deletingTrap,
    load,
    refreshDeployments,
    runAction,
    createTraps,
    loadQemuImages,
    isServiceAvailable,
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
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
});
