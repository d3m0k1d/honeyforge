import { defineStore } from "pinia";
import type { EventRead } from "~/types/api";
import { useEventsStore } from "~/stores/events";

export type AnalyticsPeriod = "24h" | "7d" | "30d" | "all";
export type AnalyticsSortKey =
  | "ts"
  | "source"
  | "service"
  | "action"
  | "severity"
  | "agent";
export type AnalyticsSortDirection = "asc" | "desc";

export interface AnalyticsEvent extends EventRead {
  source: string;
  action: string;
  message: string;
  port: number | null;
  severity: string;
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

function severityWeight(severity: string) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;

  return severity === "info" ? 1 : 0;
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
    case "agent":
      return a.agent_id.localeCompare(b.agent_id);
    default:
      return 0;
  }
}

export const useAnalyticsStore = defineStore("analytics", () => {
  const events = useEventsStore();

  const agentId = ref<string | null>(null);
  const period = ref<AnalyticsPeriod>("7d");
  const search = ref("");
  const serviceFilter = ref("all");
  const actionFilter = ref("all");
  const severityFilter = ref("all");
  const sort = ref<AnalyticsSort>({ field: "ts", direction: "desc" });

  const baseEvents = computed<AnalyticsEvent[]>(() => events.events.map((event) => ({
    ...event,
    source: event.src ?? "",
    action: event.event,
    message: event.data ? JSON.stringify(event.data) : "",
    port: event.destination_port ?? null,
    // level describes honeypot interaction, not event severity.
    severity: event.severity ?? "unknown",
  })));

  const scopedEvents = computed<AnalyticsEvent[]>(() => {
    const id = agentId.value;

    if (!id) return baseEvents.value;

    return baseEvents.value.filter((event) => event.agent_id === id);
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
        event.agent_id,
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

  const uniqueAttackers = computed(
    () => new Set(filteredEvents.value.map((event) => event.src).filter(Boolean)).size,
  );

  const criticalCount = computed(
    () => filteredEvents.value.filter((event) => event.severity === "critical").length,
  );

  const involvedAgents = computed(
    () => new Set(filteredEvents.value.map((event) => event.agent_id)).size,
  );

  const severityStats = computed(() => {
    const counts: Record<string, number> = Object.create(null);

    for (const event of filteredEvents.value) {
      counts[event.severity] = (counts[event.severity] ?? 0) + 1;
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
    groupCount(filteredEvents.value, (event) => event.service),
  );

  const actionStats = computed(() =>
    groupCount(filteredEvents.value, (event) => event.action),
  );

  const topAttackers = computed(() =>
    groupCount(filteredEvents.value.filter((event) => event.src), (event) => event.source).slice(0, 10),
  );

  const agentStats = computed(() =>
    groupCount(filteredEvents.value, (event) => event.agent_id),
  );

  const timeline = computed(() => {
    const events = filteredEvents.value.filter((event) => Number.isFinite(Date.parse(event.ts)));
    const buckets = new Map<string, number>();

    const hourly = period.value === "24h";

    const sorted = [...events].sort(
      (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
    );

    const anchor = new Date();

    // Include the partial first hour/day of the rolling period.
    const bucketCount = hourly ? 25 : period.value === "7d" ? 8 : period.value === "30d" ? 31 : 0;

    if (period.value === "all") {
      for (const event of sorted) {
        const date = new Date(event.ts);
        buckets.set(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, 0);
      }
    }

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

  const agentOptions = computed(() =>
    [...new Set(baseEvents.value.map((event) => event.agent_id))].map((id) => ({ label: id, value: id })),
  );

  function setAgent(id: string | null) {
    agentId.value = id;
  }

  function setPeriod(value: AnalyticsPeriod) {
    period.value = value;
  }

  function setSearch(value: string) {
    search.value = value;
  }

  function setServiceFilter(value: string) {
    serviceFilter.value = value;
  }

  function setActionFilter(value: string) {
    actionFilter.value = value;
  }

  function setSeverityFilter(value: string) {
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
    agentId.value = null;
    period.value = "7d";
    search.value = "";
    serviceFilter.value = "all";
    actionFilter.value = "all";
    severityFilter.value = "all";
    sort.value = { field: "ts", direction: "desc" };
  }

  return {
    agentId,
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
    uniqueAttackers,
    criticalCount,
    involvedAgents,
    severityStats,
    serviceStats,
    actionStats,
    topAttackers,
    agentStats,
    timeline,
    agentOptions,
    setAgent,
    setPeriod,
    setSearch,
    setServiceFilter,
    setActionFilter,
    setSeverityFilter,
    setSort,
    reset,
  };
});
