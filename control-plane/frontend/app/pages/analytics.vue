<script setup lang="ts">
definePageMeta({ permission: "analytics:read" });

import type { ChartData, ChartOptions } from "chart.js";
import { actionLabel } from "~/utils/traps";
import { PERIODS } from "~/stores/analytics";

const GRID = "rgba(148, 163, 184, 0.12)";
const AXIS = "#94a3b8";

const store = useAnalyticsStore();
const traps = useTrapsStore();
const route = useRoute();

const stats = computed(() => {
  const overview = store.overview;

  return [
    {
      label: "Событий в выборке",
      value: (overview?.total ?? 0).toLocaleString("ru-RU"),
      icon: "i-lucide-activity",
    },
    {
      label: "Уникальных атакующих",
      value: String(overview?.unique_sources ?? 0),
      icon: "i-lucide-users-round",
    },
    {
      label: "Критических",
      value: String(store.criticalCount),
      icon: "i-lucide-shield-alert",
    },
    {
      label: "Ловушек затронуто",
      value: String(store.involvedTraps),
      icon: "i-lucide-radar",
    },
  ];
});

const timelineData = computed<ChartData<"line">>(() => ({
  labels: store.timeline.labels,
  datasets: [
    {
      label: "События",
      data: store.timeline.values,
      borderColor: "#10b981",
      backgroundColor: "rgba(16, 185, 129, 0.15)",
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    },
  ],
}));

const severityData = computed<ChartData<"doughnut">>(() => ({
  labels: ["Инфо", "Предупреждение", "Критично"],
  datasets: [
    {
      data: [
        store.severityStats.info,
        store.severityStats.warning,
        store.severityStats.critical,
      ],
      backgroundColor: ["#38bdf8", "#f59e0b", "#f43f5e"],
      borderWidth: 0,
      hoverOffset: 6,
    },
  ],
}));

const serviceData = computed<ChartData<"bar">>(() => ({
  labels: store.serviceStats.map((item) => item.label),
  datasets: [
    {
      label: "События",
      data: store.serviceStats.map((item) => item.count),
      backgroundColor: "rgba(16, 185, 129, 0.35)",
      borderColor: "#10b981",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const actionData = computed<ChartData<"bar">>(() => ({
  labels: store.actionStats.map((item) => actionLabel(item.label)),
  datasets: [
    {
      label: "События",
      data: store.actionStats.map((item) => item.count),
      backgroundColor: "rgba(56, 189, 248, 0.35)",
      borderColor: "#38bdf8",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const attackerData = computed<ChartData<"bar">>(() => ({
  labels: store.topAttackers.map((item) => item.label),
  datasets: [
    {
      label: "События",
      data: store.topAttackers.map((item) => item.count),
      backgroundColor: "rgba(244, 63, 94, 0.35)",
      borderColor: "#f43f5e",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const trapData = computed<ChartData<"bar">>(() => ({
  labels: store.trapStats.map((item) => item.label),
  datasets: [
    {
      label: "События",
      data: store.trapStats.map((item) => item.count),
      backgroundColor: "rgba(245, 158, 11, 0.35)",
      borderColor: "#f59e0b",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const timelineOptions: ChartOptions<"line"> = {
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: GRID }, ticks: { color: AXIS, maxRotation: 0 } },
    y: {
      grid: { color: GRID },
      ticks: { color: AXIS, precision: 0 },
      border: { display: false },
    },
  },
};

const donutOptions: ChartOptions<"doughnut"> = {
  cutout: "68%",
  plugins: {
    legend: {
      position: "bottom",
      labels: { color: AXIS, boxWidth: 10, boxHeight: 10, padding: 12 },
    },
  },
};

const barOptions: ChartOptions<"bar"> = {
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { color: AXIS, maxRotation: 0 } },
    y: {
      grid: { color: GRID },
      ticks: { color: AXIS, precision: 0 },
      border: { display: false },
    },
  },
};

const attackerOptions: ChartOptions<"bar"> = {
  indexAxis: "y",
  plugins: { legend: { display: false } },
  scales: {
    x: {
      grid: { color: GRID },
      ticks: { color: AXIS, precision: 0 },
      border: { display: false },
    },
    y: { grid: { display: false }, ticks: { color: AXIS } },
  },
};

const showTrapChart = computed(() => !store.trapId && store.trapStats.length > 1);

const periodLabel = computed(
  () => PERIODS.find((item) => item.key === store.period)?.label ?? "",
);

const scopeName = computed(() =>
  store.activeTrap ? store.activeTrap.name || store.activeTrap.id : null,
);

onMounted(async () => {
  await traps.load();

  const id = route.query.trap;

  if (typeof id === "string" && traps.getTrap(id)) {
    // setTrap сам перезапрашивает данные (watcher в сторе).
    store.setTrap(id);
    return;
  }

  await store.load();
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-eyebrow">Мониторинг · HoneypotForge</p>
        <h1 class="mt-1 text-lg font-semibold tracking-tight text-highlighted">
          Аналитика
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Журнал событий всех ловушек: агрегированная статистика по
          приоритетам, протоколам и типам атак, топ источников и выгрузка
          данных.
        </p>
      </div>

      <div
        v-if="scopeName"
        class="flex items-center gap-2 rounded-lg border border-default bg-elevated/60 px-3 py-1.5"
      >
        <UIcon name="i-lucide-radar" class="size-4 text-primary" />
        <span class="text-sm text-highlighted">{{ scopeName }}</span>
        <button
          type="button"
          class="cursor-pointer rounded text-muted transition-colors hover:text-highlighted"
          @click="store.setTrap(null)"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <UCard v-for="item in stats" :key="item.label" :ui="{ body: 'p-4' }">
        <div class="flex items-center gap-3">
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon :name="item.icon" class="size-4 text-primary" />
          </div>
          <div>
            <p class="text-eyebrow">{{ item.label }}</p>
            <p class="mt-0.5 font-mono text-lg text-highlighted tabular-nums">
              {{ item.value }}
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <AnalyticsToolbar />

    <UAlert
      v-if="store.error"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      title="Не удалось загрузить аналитику"
      :description="store.error"
    />

    <div class="grid gap-3 lg:grid-cols-3">
      <UCard class="lg:col-span-2" :ui="{ body: 'p-4', header: 'p-4 pb-0' }">
        <template #header>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-sm font-semibold text-highlighted">
              Активность во времени
            </h2>
            <span class="font-mono text-[11px] text-muted">
              {{ periodLabel.toLowerCase() }}
            </span>
          </div>
        </template>
        <DashboardChart
          type="line"
          :data="timelineData"
          :options="timelineOptions"
          :height="230"
        />
      </UCard>

      <UCard :ui="{ body: 'p-4', header: 'p-4 pb-0' }">
        <template #header>
          <h2 class="text-sm font-semibold text-highlighted">
            Распределение по приоритетам
          </h2>
        </template>
        <DashboardChart
          type="doughnut"
          :data="severityData"
          :options="donutOptions"
          :height="230"
        />
      </UCard>

      <UCard :ui="{ body: 'p-4', header: 'p-4 pb-0' }">
        <template #header>
          <h2 class="text-sm font-semibold text-highlighted">
            События по протоколам
          </h2>
        </template>
        <DashboardChart
          type="bar"
          :data="serviceData"
          :options="barOptions"
          :height="220"
        />
      </UCard>

      <UCard :ui="{ body: 'p-4', header: 'p-4 pb-0' }">
        <template #header>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-sm font-semibold text-highlighted">
              Топ атакующих
            </h2>
            <span class="font-mono text-[11px] text-muted">топ-10 IP</span>
          </div>
        </template>
        <DashboardChart
          type="bar"
          :data="attackerData"
          :options="attackerOptions"
          :height="220"
        />
      </UCard>

      <UCard :ui="{ body: 'p-4', header: 'p-4 pb-0' }">
        <template #header>
          <h2 class="text-sm font-semibold text-highlighted">
            Типы действий
          </h2>
        </template>
        <DashboardChart
          type="bar"
          :data="actionData"
          :options="barOptions"
          :height="220"
        />
      </UCard>

      <UCard
        v-if="showTrapChart"
        :ui="{ body: 'p-4', header: 'p-4 pb-0' }"
      >
        <template #header>
          <h2 class="text-sm font-semibold text-highlighted">
            Активность по ловушкам
          </h2>
        </template>
        <DashboardChart
          type="bar"
          :data="trapData"
          :options="barOptions"
          :height="220"
        />
      </UCard>
    </div>

    <div>
      <div class="mb-3">
        <p class="text-eyebrow">Журнал</p>
        <h2 class="mt-1 text-sm font-semibold text-highlighted">
          События
          <span class="font-mono font-normal text-muted">
            · {{ store.journalTotal }}
          </span>
        </h2>
      </div>

      <AnalyticsEventLog />
    </div>
  </div>
</template>
