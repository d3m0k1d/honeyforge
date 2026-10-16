<script setup lang="ts">
definePageMeta({ permission: "analytics:read" });

import type { ChartData, ChartOptions } from "chart.js";
import { PERIODS } from "~/stores/analytics";
import { useEventsStore } from "~/stores/events";

const GRID = "rgba(148, 163, 184, 0.12)";
const AXIS = "#94a3b8";

const store = useAnalyticsStore();
const eventsStore = useEventsStore();
const route = useRoute();

const stats = computed(() => {
  const events = store.sortedEvents;
  const unavailable = Boolean(eventsStore.error) || (eventsStore.loading && !store.baseEvents.length);

  return [
    {
      label: "Событий в выборке",
      value: unavailable ? "—" : events.length.toLocaleString("ru-RU"),
      icon: "i-lucide-activity",
    },
    {
      label: "Уникальных атакующих",
      value: unavailable ? "—" : String(store.uniqueAttackers),
      icon: "i-lucide-users-round",
    },
    {
      label: "Критических",
      value: unavailable ? "—" : String(
        events.filter((event) => event.severity === "critical").length,
      ),
      icon: "i-lucide-shield-alert",
    },
    {
      label: "Агентов в выборке",
      value: unavailable ? "—" : String(store.involvedAgents),
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
  labels: Object.keys(store.severityStats),
  datasets: [
    {
      data: Object.values(store.severityStats),
      backgroundColor: Object.keys(store.severityStats).map((key) =>
        key === "critical" ? "#f43f5e" : key === "warning" ? "#f59e0b" : key === "info" ? "#38bdf8" : "#94a3b8"),
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
  labels: store.actionStats.map((item) => item.label),
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

const agentData = computed<ChartData<"bar">>(() => ({
  labels: store.agentStats.map((item) => item.label),
  datasets: [
    {
      label: "События",
      data: store.agentStats.map((item) => item.count),
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

const showAgentChart = computed(() => !store.agentId && store.agentStats.length > 1);

const periodLabel = computed(
  () => PERIODS.find((item) => item.key === store.period)?.label ?? "",
);

let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  const id = route.query.agent;
  if (typeof id === "string") store.setAgent(id);
  void eventsStore.load();
  poll = setInterval(() => { void eventsStore.load(); }, 5000);
});
onUnmounted(() => clearInterval(poll));
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
          Журнал событий агентов: агрегированная статистика по
          приоритетам, протоколам и типам атак, топ источников и выгрузка
          данных.
        </p>
      </div>

      <div
        v-if="store.agentId"
        class="flex items-center gap-2 rounded-lg border border-default bg-elevated/60 px-3 py-1.5"
      >
        <UIcon name="i-lucide-radar" class="size-4 text-primary" />
        <span class="text-sm text-highlighted">Agent ID: {{ store.agentId }}</span>
        <button
          type="button"
          class="cursor-pointer rounded text-muted transition-colors hover:text-highlighted"
          aria-label="Все агенты"
          @click="store.setAgent(null)"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted" aria-live="polite">
      <p>Фильтры и графики: последние {{ eventsStore.limit }} событий, не полная история.
        <span v-if="eventsStore.stats">Всего в API (без фильтров): {{ eventsStore.stats.total.toLocaleString('ru-RU') }}.</span>
      </p>
      <UButton label="Обновить" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="eventsStore.loading" @click="eventsStore.load()" />
    </div>
    <UAlert v-if="eventsStore.error" color="error" title="Не удалось обновить события" :description="eventsStore.error" />
    <p v-if="eventsStore.loading && !store.baseEvents.length" role="status" class="text-sm text-muted">Загрузка событий…</p>

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
        v-if="showAgentChart"
        :ui="{ body: 'p-4', header: 'p-4 pb-0' }"
      >
        <template #header>
          <h2 class="text-sm font-semibold text-highlighted">
            Активность по агентам
          </h2>
        </template>
        <DashboardChart
          type="bar"
          :data="agentData"
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
