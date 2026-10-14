import { defineStore } from "pinia";
import type {
  ServiceKey,
  Trap,
  TrapEvent,
  TrapEventAction,
  TrapEventSeverity,
} from "~/types/traps";
import { PROFILE_BY_ID, SEVERITY_LABELS, SERVICE_BY_KEY } from "~/utils/traps";
import { useTrapsStore } from "~/stores/traps";

export type AnalyticsPeriod = "24h" | "7d" | "30d" | "all";
export type AnalyticsSortKey =
  | "ts"
  | "source"
  | "service"
  | "action"
  | "severity"
  | "trap";
export type AnalyticsSortDirection = "asc" | "desc";

export interface AnalyticsEvent extends TrapEvent {
  trapName: string;
}

export interface AnalyticsSort {
  field: AnalyticsSortKey;
  direction: AnalyticsSortDirection;
}

export const PERIODS: { key: AnalyticsPeriod; label: string; ms: number | null }[] = [
  { key: "24h", label: "Последние 24 часа", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Последние 7 дней", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Последние 30 дней", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "Всё время", ms: null },
];

function severityWeight(severity: TrapEventSeverity) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;

  return 1;
}

function compare(
  a: AnalyticsEvent,
  b: AnalyticsEvent,
  field: AnalyticsSortKey,
) {
  switch (field) {
    case "ts":
      return Date.parse(a.ts) - Date.parse(b.ts);
    case "source":
      return a.source.localeCompare(b.source);
    case "service":
      return a.service.localeCompare(b.service);
    case "action":
      return a.action.localeCompare(b.action);
    case "severity":
      return severityWeight(a.severity) - severityWeight(b.severity);
    case "trap":
      return a.trapName.localeCompare(b.trapName, "ru");
    default:
      return 0;
  }
}

export const useAnalyticsStore = defineStore("analytics", () => {
  const traps = useTrapsStore();

  const trapId = ref<string | null>(null);
  const period = ref<AnalyticsPeriod>("7d");
  const search = ref("");
  const serviceFilter = ref<ServiceKey | "all">("all");
  const actionFilter = ref<TrapEventAction | "all">("all");
  const severityFilter = ref<TrapEventSeverity | "all">("all");
  const sort = ref<AnalyticsSort>({ field: "ts", direction: "desc" });

  const baseEvents = computed<AnalyticsEvent[]>(() => {
    const list: AnalyticsEvent[] = [];

    for (const trap of traps.traps) {
      const name =
        trap.name || PROFILE_BY_ID[trap.profileId]?.name || trap.id;

      for (const event of trap.events) {
        list.push({ ...event, trapId: trap.id, trapName: name });
      }
    }

    return list;
  });

  const scopedEvents = computed<AnalyticsEvent[]>(() => {
    const id = trapId.value;

    if (!id) return baseEvents.value;

    return baseEvents.value.filter((event) => event.trapId === id);
  });

  const periodEvents = computed<AnalyticsEvent[]>(() => {
    const spec = PERIODS.find((item) => item.key === period.value);

    if (!spec?.ms) return scopedEvents.value;

    const cutoff = Date.now() - spec.ms;

    return scopedEvents.value.filter((event) => Date.parse(event.ts) >= cutoff);
  });

  const filteredEvents = computed<AnalyticsEvent[]>(() => {
    const query = search.value.trim().toLowerCase();
    const service = serviceFilter.value;
    const action = actionFilter.value;
    const severity = severityFilter.value;

    return periodEvents.value.filter((event) => {
      if (service !== "all" && event.service !== service) return false;
      if (action !== "all" && event.action !== action) return false;
      if (severity !== "all" && event.severity !== severity) return false;

      if (!query) return true;

      const haystack = [
        event.source,
        event.message,
        event.action,
        event.service,
        event.trapName,
        String(event.port),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  });

  const sortedEvents = computed<AnalyticsEvent[]>(() => {
    const direction = sort.value.direction === "asc" ? 1 : -1;

    return [...filteredEvents.value].sort(
      (a, b) => compare(a, b, sort.value.field) * direction,
    );
  });

  const activeTrap = computed<Trap | null>(() =>
    trapId.value ? traps.getTrap(trapId.value) : null,
  );

  const uniqueAttackers = computed(
    () => new Set(periodEvents.value.map((event) => event.source)).size,
  );

  const criticalCount = computed(
    () => periodEvents.value.filter((event) => event.severity === "critical").length,
  );

  const involvedTraps = computed(
    () => new Set(periodEvents.value.map((event) => event.trapId)).size,
  );

  const severityStats = computed(() => {
    const counts: Record<TrapEventSeverity, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    };

    for (const event of periodEvents.value) {
      counts[event.severity]++;
    }

    return counts;
  });

  function groupCount<T extends string>(
    events: AnalyticsEvent[],
    key: (event: AnalyticsEvent) => T,
  ) {
    const counts = new Map<T, number>();

    for (const event of events) {
      const value = key(event);

      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  const serviceStats = computed(() =>
    groupCount(periodEvents.value, (event) => event.service).map((item) => ({
      ...item,
      label: SERVICE_BY_KEY[item.label as ServiceKey]?.label ?? item.label,
    })),
  );

  const actionStats = computed(() =>
    groupCount(periodEvents.value, (event) => event.action),
  );

  const topAttackers = computed(() =>
    groupCount(periodEvents.value, (event) => event.source).slice(0, 10),
  );

  const trapStats = computed(() =>
    groupCount(periodEvents.value, (event) => event.trapName),
  );

  const timeline = computed(() => {
    const events = periodEvents.value;
    const buckets = new Map<string, number>();

    const hourly = period.value === "24h";

    const sorted = [...events].sort(
      (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
    );

    const anchor = sorted.length
      ? new Date(sorted[sorted.length - 1]!.ts)
      : new Date();

    const bucketCount = hourly ? 24 : 21;

    for (let i = bucketCount - 1; i >= 0; i--) {
      const date = new Date(anchor);

      if (hourly) {
        date.setHours(anchor.getHours() - i, 0, 0, 0);
        buckets.set(
          `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`,
          0,
        );
      } else {
        date.setHours(0, 0, 0, 0);
        date.setDate(anchor.getDate() - i);
        buckets.set(
          `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
          0,
        );
      }
    }

    for (const event of events) {
      const date = new Date(event.ts);

      const key = hourly
        ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`
        : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }

    const labels = [...buckets.keys()].map((key) => {
      const [year, month, day, hour] = key.split("-").map(Number);
      const date = new Date(year!, month!, day!, hour ?? 0);

      if (hourly) {
        return `${String(date.getHours()).padStart(2, "0")}:00`;
      }

      return `${String(date.getDate()).padStart(2, "0")}.${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;
    });

    return {
      labels,
      values: [...buckets.values()],
    };
  });

  const trapOptions = computed(() =>
    traps.traps.map((trap) => ({
      label: trap.name || trap.id,
      value: trap.id,
    })),
  );

  function setTrap(id: string | null) {
    trapId.value = id;
  }

  function setPeriod(value: AnalyticsPeriod) {
    period.value = value;
  }

  function setSearch(value: string) {
    search.value = value;
  }

  function setServiceFilter(value: ServiceKey | "all") {
    serviceFilter.value = value;
  }

  function setActionFilter(value: TrapEventAction | "all") {
    actionFilter.value = value;
  }

  function setSeverityFilter(value: TrapEventSeverity | "all") {
    severityFilter.value = value;
  }

  function setSort(field: AnalyticsSortKey) {
    if (sort.value.field === field) {
      sort.value = {
        field,
        direction: sort.value.direction === "asc" ? "desc" : "asc",
      };
      return;
    }

    sort.value = {
      field,
      direction: field === "ts" ? "desc" : "asc",
    };
  }

  function reset() {
    trapId.value = null;
    period.value = "7d";
    search.value = "";
    serviceFilter.value = "all";
    actionFilter.value = "all";
    severityFilter.value = "all";
    sort.value = { field: "ts", direction: "desc" };
  }

  return {
    trapId,
    period,
    search,
    serviceFilter,
    actionFilter,
    severityFilter,
    sort,
    baseEvents,
    scopedEvents,
    periodEvents,
    filteredEvents,
    sortedEvents,
    activeTrap,
    uniqueAttackers,
    criticalCount,
    involvedTraps,
    severityStats,
    serviceStats,
    actionStats,
    topAttackers,
    trapStats,
    timeline,
    trapOptions,
    setTrap,
    setPeriod,
    setSearch,
    setServiceFilter,
    setActionFilter,
    setSeverityFilter,
    setSort,
    reset,
  };
});
