import { defineStore } from "pinia";
import type {
  ServiceKey,
  Trap,
  TrapFieldKey,
  TrapLevel,
  TrapSort,
} from "~/types/traps";
import {
  AGENT_BY_ID,
  LEVEL_BY_KEY,
  PROFILES,
  PROFILE_BY_ID,
  TRAP_FIELDS,
  seedTraps,
} from "~/utils/traps";
import { createId } from "~/utils/schema";

const TRAPS_KEY = "honeypotforge:traps";
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
      return (PROFILE_BY_ID[a.profileId]?.name ?? "").localeCompare(
        PROFILE_BY_ID[b.profileId]?.name ?? "",
        "ru",
      );
    case "port":
      return (a.services[0]?.port ?? 0) - (b.services[0]?.port ?? 0);
    case "level":
      return levelWeight(a.level) - levelWeight(b.level);
    case "agent":
      return (AGENT_BY_ID[a.agentId]?.name ?? "").localeCompare(
        AGENT_BY_ID[b.agentId]?.name ?? "",
        "ru",
      );
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

export interface CreateTrapInput {
  profileId: string;
  name: string;
  description: string;
  services: { key: ServiceKey; port: number }[];
  level: TrapLevel;
  agentId: string;
  agentStatus: "online" | "syncing";
}

export const useTrapsStore = defineStore("traps", () => {
  const traps = ref<Trap[]>(seedTraps());
  const fieldVisibility = ref<Record<TrapFieldKey, boolean>>(
    defaultVisibility(),
  );
  const serviceVisibility = ref<Record<ServiceKey, boolean>>({
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
      PROFILES.map((profile) => ({
        profile,
        count: traps.value.filter((trap) => trap.profileId === profile.id)
          .length,
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

      const profile = PROFILE_BY_ID[trap.profileId];
      const haystack = [
        trap.name,
        trap.id,
        trap.description,
        profile?.name ?? "",
        AGENT_BY_ID[trap.agentId]?.name ?? "",
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

  const totalEvents = computed(() =>
    traps.value.reduce((sum, trap) => sum + trap.eventsCount, 0),
  );

  const onlineCount = computed(
    () => traps.value.filter((trap) => trap.agentStatus === "online").length,
  );

  function load() {
    const stored = readJson<Trap[]>(TRAPS_KEY, []);

    traps.value = stored.length ? stored : seedTraps();
    fieldVisibility.value = {
      ...defaultVisibility(),
      ...readJson<Partial<Record<TrapFieldKey, boolean>>>(FIELDS_KEY, {}),
    };
  }

  function persist() {
    writeJson(TRAPS_KEY, traps.value);
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

  function createTrap(input: CreateTrapInput) {
    const profile = PROFILE_BY_ID[input.profileId];

    const created: Trap = {
      id: createId("trap"),
      name: input.name.trim() || profile?.name || "новая ловушка",
      profileId: input.profileId,
      description: input.description.trim(),
      services: input.services
        .filter((service) => service.port > 0)
        .map((service) => ({ ...service })),
      level: input.level,
      agentId: input.agentId,
      agentStatus: input.agentStatus,
      eventsCount: 0,
      events: [],
      createdAt: new Date().toISOString(),
    };

    traps.value = [created, ...traps.value];
    persist();

    return created;
  }

  function setAgentStatus(id: string, status: Trap["agentStatus"]) {
    const trap = getTrap(id);

    if (!trap) return;

    trap.agentStatus = status;
    persist();
  }

  function requestDelete(id: string) {
    pendingDeleteId.value = id;
  }
  function cancelDelete() {
    pendingDeleteId.value = null;
  }

  function confirmDelete() {
    if (!pendingDeleteId.value) return null;

    const removed = getTrap(pendingDeleteId.value);

    traps.value = traps.value.filter((trap) => trap.id !== pendingDeleteId.value);
    pendingDeleteId.value = null;
    persist();

    return removed ?? null;
  }

  function levelInfo(level: TrapLevel) {
    return LEVEL_BY_KEY[level];
  }

  return {
    traps,
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
    setAgentStatus,
    requestDelete,
    cancelDelete,
    confirmDelete,
    levelInfo,
  };
});
