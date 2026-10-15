import { defineStore } from "pinia";
import type { AnalyticsOverview, EventRead } from "~/types/api";
import { resources } from "~/api/resources";
import { toApiError } from "~/api/errors";
import type {
  ServiceKey,
  Trap,
  TrapEvent,
  TrapEventAction,
  TrapEventSeverity,
} from "~/types/traps";
import {
  actionLabel,
  findTrapForEvent,
  mapEvent,
  serviceMeta,
} from "~/utils/traps";
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

/** Размер серверной страницы журнала (GET /events?limit&offset). */
export const JOURNAL_PAGE_SIZE = 25;
/** Окно событий для графиков (timeline/ловушки/критичные). */
const WINDOW_LIMIT = 1000;

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

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isExactIp(value: string) {
  return IPV4.test(value.trim());
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

  const page = ref(1);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const overview = ref<AnalyticsOverview | null>(null);
  /** Окно событий (≤1000) — timeline, критичные, ловушки. */
  const windowEvents = ref<AnalyticsEvent[]>([]);
  /** Текущая серверная страница журнала. */
  const journalRows = ref<AnalyticsEvent[]>([]);
  /** Всего строк по фильтрам сервера (из /analytics/overview). */
  const journalTotal = ref(0);

  /** Серверные параметры: период/сервис/действие/ловушка/источник(IP). */
  const serverQuery = computed(() => {
    const query: {
      since?: string;
      agent_id?: string;
      src?: string;
      event?: string;
      service?: string;
      limit?: number;
      offset?: number;
    } = {};

    const spec = PERIODS.find((item) => item.key === period.value);
    if (spec?.ms) query.since = new Date(Date.now() - spec.ms).toISOString();

    if (serviceFilter.value !== "all") query.service = serviceFilter.value;
    if (actionFilter.value !== "all") query.event = actionFilter.value;

    const trap = trapId.value ? traps.getTrap(trapId.value) : null;
    if (trap) {
      query.agent_id = trap.agentId;

      // узкая ловушка (один сервис) — уточняем агрегаты по сервису,
      // чтобы total журнала совпадал с числом строк ловушки
      const trapService = trap.services[0];
      if (trapService && serviceFilter.value === "all") {
        query.service = trapService.key;
      }
    }

    // Свободный текст ищем по строкам, точный IP — фильтром src на сервере.
    const query0 = search.value.trim();
    if (query0 && isExactIp(query0)) query.src = query0;

    return query;
  });

  function attach(rows: EventRead[]): AnalyticsEvent[] {
    const list: AnalyticsEvent[] = [];

    for (const row of rows) {
      const trap = findTrapForEvent(
        traps.traps,
        row.agent_id,
        row.service,
      );

      if (trapId.value && trap?.id !== trapId.value) continue;

      const name = trap
        ? trap.name || traps.profilesById[trap.profileId]?.name || trap.id
        : row.agent_id;

      list.push({
        ...mapEvent(row, {
          trapId: trap?.id ?? "",
          port: trap?.services[0]?.port ?? 0,
        }),
        trapId: trap?.id ?? "",
        trapName: name,
      });
    }

    return list;
  }

  async function fetchOverview(force = false) {
    const data = await resources.analytics.overview(serverQuery.value, {
      cache: { force },
    });

    overview.value = data;
    journalTotal.value = data.total;
  }

  async function fetchWindow(force = false) {
    const rows = await resources.events.list(
      { ...serverQuery.value, limit: WINDOW_LIMIT },
      { cache: { ttl: 15_000, staleTtl: 60_000, tags: ["events"], force } },
    );

    windowEvents.value = attach(rows);
  }

  async function fetchJournal(force = false) {
    const rows = await resources.events.list(
      {
        ...serverQuery.value,
        limit: JOURNAL_PAGE_SIZE,
        offset: (page.value - 1) * JOURNAL_PAGE_SIZE,
      },
      { cache: { ttl: 15_000, staleTtl: 60_000, tags: ["events"], force } },
    );

    journalRows.value = attach(rows);
  }

  async function load(force = false): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      await Promise.all([
        fetchOverview(force),
        fetchWindow(force),
        fetchJournal(force),
      ]);
    } catch (err) {
      error.value = toApiError(err).message;
    } finally {
      loading.value = false;
    }
  }

  /** Смена серверной страницы журнала. */
  async function setPage(value: number): Promise<void> {
    if (value < 1 || value === page.value) return;

    page.value = value;
    loading.value = true;

    try {
      await fetchJournal(true);
    } catch (err) {
      error.value = toApiError(err).message;
    } finally {
      loading.value = false;
    }
  }

  function resetPageAndLoad() {
    page.value = 1;
    void load(true);
  }

  // Серверные фильтры → перезапрос агрегатов и журнала.
  watch(
    [period, serviceFilter, actionFilter, trapId],
    () => resetPageAndLoad(),
  );

  // Поиск: точный IP меняет src-параметр сервера; иначе только клиентская
  // доработка строк — перезапрос не нужен (кроме сброса после IP).
  let searchWasIp = isExactIp(search.value);
  watch(search, (value) => {
    const ip = isExactIp(value);

    if (ip || searchWasIp) resetPageAndLoad();
    searchWasIp = ip;
  });

  /** Клиентские доработки поверх серверной страницы журнала. */
  const journalSorted = computed(() => {
    const query = search.value.trim().toLowerCase();
    const severity = severityFilter.value;

    const rows = journalRows.value.filter((event) => {
      if (severity !== "all" && event.severity !== severity) return false;
      if (!query || isExactIp(query)) return true;

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

    const direction = sort.value.direction === "asc" ? 1 : -1;

    return [...rows].sort(
      (a, b) => compare(a, b, sort.value.field) * direction,
    );
  });

  /** Выборка для экспорта — окно событий с клиентскими доработками. */
  const exportEvents = computed(() => {
    const query = search.value.trim().toLowerCase();
    const severity = severityFilter.value;

    const rows = windowEvents.value.filter((event) => {
      if (severity !== "all" && event.severity !== severity) return false;
      if (!query || isExactIp(query)) return true;

      return (
        [
          event.source,
          event.message,
          event.action,
          event.service,
          event.trapName,
          String(event.port),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    });

    const direction = sort.value.direction === "asc" ? 1 : -1;

    return [...rows].sort(
      (a, b) => compare(a, b, sort.value.field) * direction,
    );
  });

  const activeTrap = computed<Trap | null>(() =>
    trapId.value ? traps.getTrap(trapId.value) : null,
  );

  const total = computed(() => overview.value?.total ?? 0);
  const uniqueAttackers = computed(
    () => overview.value?.unique_sources ?? 0,
  );

  const criticalCount = computed(
    () => windowEvents.value.filter((event) => event.severity === "critical")
      .length,
  );

  const involvedTraps = computed(
    () =>
      new Set(
        windowEvents.value
          .map((event) => event.trapId)
          .filter(Boolean),
      ).size,
  );

  const severityStats = computed(() => {
    const counts: Record<TrapEventSeverity, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    };

    for (const event of windowEvents.value) {
      counts[event.severity]++;
    }

    return counts;
  });

  /** Счётчики из агрегата by_event. */
  const actionStats = computed(() =>
    Object.entries(overview.value?.by_event ?? {})
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  );

  /** Счётчики из агрегата by_service (лейблы каталога). */
  const serviceStats = computed(() =>
    Object.entries(overview.value?.by_service ?? {})
      .map(([key, count]) => ({ label: serviceMeta(key).label, count }))
      .sort((a, b) => b.count - a.count),
  );

  /** Опции фильтров — из агрегатов backend (живые данные выборки). */
  const serviceOptions = computed(() =>
    Object.keys(overview.value?.by_service ?? {})
      .map((key) => ({ label: serviceMeta(key).label, value: key as ServiceKey }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru")),
  );

  const actionOptions = computed(() =>
    Object.keys(overview.value?.by_event ?? {})
      .map((value) => ({ label: actionLabel(value), value }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru")),
  );

  const topAttackers = computed(() =>
    Object.entries(overview.value?.top_sources ?? {})
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  );

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

  const trapStats = computed(() =>
    groupCount(windowEvents.value, (event) => event.trapName),
  );

  const timeline = computed(() => {
    const events = windowEvents.value;
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
    page.value = 1;
    void load(true);
  }

  return {
    trapId,
    period,
    search,
    serviceFilter,
    actionFilter,
    severityFilter,
    sort,
    page,
    loading,
    error,
    overview,
    windowEvents,
    journalRows,
    journalSorted,
    journalTotal,
    exportEvents,
    total,
    uniqueAttackers,
    criticalCount,
    involvedTraps,
    severityStats,
    serviceStats,
    actionStats,
    serviceOptions,
    actionOptions,
    topAttackers,
    trapStats,
    timeline,
    activeTrap,
    trapOptions,
    load,
    setPage,
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
