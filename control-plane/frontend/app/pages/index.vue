<script setup lang="ts">
import type { ChartData, ChartOptions } from "chart.js";
import { SEVERITY_LABELS, formatDateTime } from "~/utils/traps";

const GRID = "rgba(148, 163, 184, 0.12)";
const AXIS = "#94a3b8";

const auth = useAuthStore();
const settings = useSettingsStore();
const trapsStore = useTrapsStore();
const agentsStore = useAgentsStore();
const eventsStore = useEventsStore();

// туманность/липкий герой — только для радиального режима навигации;
// при обычной навигации главный экран рендерится «по-простому»
const fogMode = computed(() => settings.navMode === "radial");

const activity = computed(() => {
  const buckets = new Map<number, number>();
  for (const event of eventsStore.events) {
    const timestamp = Date.parse(event.ts);
    if (!Number.isFinite(timestamp)) continue;
    const minute = Math.floor(timestamp / 60_000) * 60_000;
    buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b);
});

const lineData = computed<ChartData<"line">>(() => ({
  labels: activity.value.map(([timestamp]) => formatDateTime(new Date(timestamp).toISOString())),
  datasets: [
    {
      label: "События",
      data: activity.value.map(([, count]) => count),
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

const vectors = computed(() => eventsStore.stats?.by_event ?? {});

const donutData = computed<ChartData<"doughnut">>(() => ({
  labels: Object.keys(vectors.value),
  datasets: [
    {
      data: Object.values(vectors.value),
      backgroundColor: ["#10b981", "#38bdf8", "#f59e0b", "#f43f5e"],
      borderWidth: 0,
      hoverOffset: 6,
    },
  ],
}));

const services = computed(() => Object.entries(eventsStore.stats?.by_service ?? {})
  .sort(([, a], [, b]) => b - a).slice(0, 5));

const barData = computed<ChartData<"bar">>(() => ({
  labels: services.value.map(([service]) => service),
  datasets: [
    {
      label: "Попадания",
      data: services.value.map(([, count]) => count),
      backgroundColor: "rgba(16, 185, 129, 0.35)",
      borderColor: "#10b981",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const lineOptions: ChartOptions<"line"> = {
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
    x: { grid: { display: false }, ticks: { color: AXIS } },
    y: {
      grid: { color: GRID },
      ticks: { color: AXIS, precision: 0 },
      border: { display: false },
    },
  },
};

let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  if (!auth.isAuthenticated) return;
  await Promise.all([
    auth.can("deployments:read") ? trapsStore.load() : Promise.resolve(),
    auth.can("agents:read") ? agentsStore.load() : Promise.resolve(),
    auth.can("events:read") ? eventsStore.load() : Promise.resolve(),
  ]);
}

onMounted(() => {
  settings.load();
  void refresh();
  timer = setInterval(() => {
    if (!document.hidden) void refresh();
  }, 5000);
});

onBeforeUnmount(() => clearInterval(timer));
watch(() => auth.user, () => { void refresh(); });

function hasWidget(key: string) {
  return settings.dashboard.includes(key);
}

const severityColor: Record<string, "neutral" | "warning" | "error"> = {
  info: "neutral",
  warning: "warning",
  critical: "error",
};

const criticalCount = computed(() =>
  eventsStore.events.filter((event) => event.severity === "critical").length,
);
const dataErrors = computed(() => [trapsStore.error, agentsStore.error, eventsStore.error].filter(Boolean));
const refreshing = computed(() => trapsStore.pending || agentsStore.pending || eventsStore.loading);
const eventsAvailable = computed(() => Boolean(eventsStore.stats) && !eventsStore.error);

const dashboardKpis = computed(() => [
  {
    label: "Ловушек",
    value: trapsStore.loaded && !trapsStore.error ? String(trapsStore.traps.length) : "—",
    icon: "i-lucide-radar",
  },
  {
    label: "Агентов онлайн",
    value: agentsStore.onlineCount === null ? "—" : String(agentsStore.onlineCount),
    icon: "i-lucide-radio",
  },
  {
    label: "Событий captured",
    value: eventsStore.stats?.total.toLocaleString("ru-RU") ?? "—",
    icon: "i-lucide-activity",
  },
  {
    label: "Критичных среди последних событий",
    value: eventsAvailable.value ? String(criticalCount.value) : "—",
    icon: "i-lucide-shield-alert",
  },
]);

const latestEvents = computed(() =>
  eventsStore.events.slice(0, 6),
);

const features = [
  {
    icon: "i-lucide-radar",
    title: "Ловушки",
    text: "Готовые профили SSH, HTTP, SMTP, БД и TCP-заглушек с настройкой портов, уровня эмуляции и агентов развёртывания.",
  },
  {
    icon: "i-lucide-chart-line",
    title: "Аналитика",
    text: "Журнал перехваченных событий, графики активности, топ атакующих IP и выгрузка в CSV, JSON, XML и Excel.",
  },
  {
    icon: "i-lucide-database",
    title: "Конструктор схем",
    text: "Визуальное проектирование таблиц и связей, SQL-редактор и просмотр данных — для моделей, кормящих ловушки.",
  },
  {
    icon: "i-lucide-shield-check",
    title: "Роли и доступы",
    text: "Разграничение прав: администратор, оператор и аналитик. Полный аудит действий в админ-панели.",
  },
];

const botCommands = [
  { cmd: "/status", desc: "состояние агентов и ловушек" },
  { cmd: "/traps", desc: "список активных ловушек" },
  { cmd: "/events", desc: "последние критичные события" },
  { cmd: "/report", desc: "сводка атак за сутки" },
];

const teamTags = ["Red Team", "Detection Eng.", "AppSec", "Automation"];
</script>

<template>
  <div v-if="!auth.isAuthenticated" class="relative">
    <section
      :class="
        fogMode
          ? 'sticky top-18 z-0 h-[calc(100vh-4.5rem)] overflow-hidden'
          : ''
      "
    >
      <HomeNebula v-if="fogMode" />

      <div
        class="relative mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6"
        :class="fogMode ? 'h-full' : ''"
      >
        <div
          class="grid gap-3 pt-6 sm:grid-cols-3"
          :class="
            fogMode
              ? '[mask-image:linear-gradient(to_bottom,black_55%,transparent_92%)]'
              : ''
          "
        >
          <UCard :ui="{ body: 'p-4' }">
            <p class="text-eyebrow">HellReign · HoneypotForge</p>
            <h1 class="mt-1 text-sm font-semibold text-highlighted">
              Модерация honeypot-инцидентов в одном окне
            </h1>
            <p class="mt-2 text-xs leading-relaxed text-muted">
              Разворачивайте honeypot-ловушки на периметре, перехватывайте атаки
              в реальном времени и разбирайте инциденты в единой панели.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <UButton
                class="cursor-pointer"
                size="sm"
                icon="i-lucide-log-in"
                label="Войти в панель"
                to="/login"
              />
              <UButton
                class="cursor-pointer"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-radar"
                label="Ловушки"
                to="/traps"
              />
            </div>
          </UCard>

          <UCard :ui="{ body: 'p-4' }">
            <div class="flex items-center gap-2">
              <div
                class="flex size-8 items-center justify-center rounded-md border border-default bg-elevated"
              >
                <UIcon name="i-lucide-bot" class="size-4 text-primary" />
              </div>
              <h2 class="text-sm font-semibold text-highlighted">
                Telegram-бот
              </h2>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-muted">
              <span class="font-mono text-toned">@honeypotforge_bot</span>
              присылает уведомления о критичных событиях ловушек в личные чаты и
              командные каналы — в момент атаки, а не когда вы открыли панель.
            </p>
            <div class="mt-4 flex flex-wrap gap-1.5">
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                label="Realtime"
              />
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                label="Команды"
              />
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                label="Каналы и ЛС"
              />
            </div>
          </UCard>

          <UCard :ui="{ body: 'p-4' }">
            <div class="flex items-center gap-2">
              <div
                class="flex size-8 items-center justify-center rounded-md border border-default bg-elevated"
              >
                <UIcon
                  name="i-lucide-heart-handshake"
                  class="size-4 text-primary"
                />
              </div>
              <h2 class="text-sm font-semibold text-highlighted">
                Команда HellReign
              </h2>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-muted">
              Security-инженеры на стыке red team и detection engineering:
              honeypot-системы, автоматизация разбора инцидентов и метрики
              атакующего. HoneypotForge — наш хакатонский проект.
            </p>
            <div class="mt-4 flex flex-wrap gap-1.5">
              <UBadge
                v-for="tag in teamTags"
                :key="tag"
                color="neutral"
                variant="outline"
                size="sm"
                :label="tag"
              />
            </div>
          </UCard>
        </div>

        <div
          v-if="fogMode"
          class="flex flex-1 items-center justify-center pb-20"
        >
          <div class="flex flex-col items-center gap-3 text-muted">
            <span
              class="relative flex size-16 items-center justify-center rounded-full border border-default bg-elevated"
            >
              <span
                class="absolute inset-0 animate-ping rounded-full border border-primary/30 [animation-duration:2.5s]"
              />
              <UIcon name="i-lucide-mouse-pointer-click" class="size-7" />
            </span>
            <span
              class="max-w-44 text-center text-xs font-medium uppercase tracking-[0.25em]"
            >
              Нажмите ЛКМ по любой области — откроется радиальное меню
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="relative z-10 border-t border-default bg-default">
      <div class="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div>
          <p class="text-eyebrow">Возможности</p>
          <h2
            class="mt-1 text-lg font-semibold tracking-tight text-highlighted"
          >
            Что внутри панели
          </h2>

          <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <UCard
              v-for="item in features"
              :key="item.title"
              :ui="{ body: 'p-4' }"
            >
              <div
                class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
              >
                <UIcon :name="item.icon" class="size-4 text-primary" />
              </div>
              <h3 class="mt-3 text-sm font-semibold text-highlighted">
                {{ item.title }}
              </h3>
              <p class="mt-1.5 text-xs leading-relaxed text-muted">
                {{ item.text }}
              </p>
            </UCard>
          </div>
        </div>

        <UCard :ui="{ body: 'p-5' }">
          <div class="flex items-start gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-md border border-default bg-elevated"
            >
              <UIcon name="i-lucide-bot" class="size-5 text-primary" />
            </div>
            <div class="min-w-0">
              <p class="text-eyebrow">Уведомления</p>
              <h2 class="mt-1 text-sm font-semibold text-highlighted">
                Telegram-бот сервиса
              </h2>
              <p class="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
                Бот связан с панелью по API: подписчики чата получают только те
                события, которые соответствуют их ролям. Критичные попадания —
                брутфорс, эксплуатация, подозрительные сессии — прилетают
                мгновенно, остальное собирается в сводки.
              </p>

              <ul class="mt-4 space-y-2">
                <li
                  v-for="item in botCommands"
                  :key="item.cmd"
                  class="flex items-center gap-3 text-xs"
                >
                  <span
                    class="rounded-md border border-default bg-elevated px-1.5 py-0.5 font-mono text-toned"
                  >
                    {{ item.cmd }}
                  </span>
                  <span class="text-muted">{{ item.desc }}</span>
                </li>
              </ul>
            </div>
          </div>
        </UCard>
      </div>
    </section>
  </div>

  <div v-else class="relative">
    <section
      v-if="fogMode"
      class="sticky top-18 z-0 h-[calc(100vh-4.5rem)] overflow-hidden"
    >
      <HomeNebula />

      <div
        class="relative mx-auto flex h-full w-full max-w-6xl flex-col px-4 sm:px-6"
      >
        <div
          v-if="!settings.dashboard.length"
          class="flex min-h-64 items-center justify-center"
        >
          <div class="flex flex-col items-center gap-2 text-muted">
            <UIcon name="i-lucide-layout-dashboard" class="size-6" />
            <p class="text-xs">
              Ни один виджет не выбран — откройте «Настройки → Главный экран»
            </p>
          </div>
        </div>

        <div
          v-if="hasWidget('kpi')"
          class="grid gap-3 pt-6 sm:grid-cols-2 xl:grid-cols-4 [mask-image:linear-gradient(to_bottom,black_55%,transparent_92%)]"
        >
          <UCard
            v-for="item in dashboardKpis"
            :key="item.label"
            :ui="{ body: 'p-4' }"
          >
            <div class="flex items-center gap-3">
              <div
                class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
              >
                <UIcon :name="item.icon" class="size-4 text-primary" />
              </div>
              <div>
                <p class="text-eyebrow">{{ item.label }}</p>
                <p
                  class="mt-0.5 font-mono text-lg text-highlighted tabular-nums"
                >
                  {{ item.value }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <div class="flex flex-1 items-center justify-center pb-20">
          <div class="flex flex-col items-center gap-3 text-muted">
            <span
              class="relative flex size-16 items-center justify-center rounded-full border border-default bg-elevated"
            >
              <span
                class="absolute inset-0 animate-ping rounded-full border border-primary/30 [animation-duration:2.5s]"
              />
              <UIcon name="i-lucide-mouse-pointer-click" class="size-7" />
            </span>
            <span
              class="max-w-44 text-center text-xs font-medium uppercase tracking-[0.25em]"
            >
              Нажмите ЛКМ по любой области — откроется радиальное меню
            </span>
          </div>
        </div>
      </div>
    </section>

    <section
      :class="fogMode ? 'relative z-10 border-t border-default bg-default' : ''"
    >
      <div
        class="mx-auto flex max-w-6xl flex-col gap-4"
        :class="fogMode ? 'px-4 py-8 sm:px-6' : ''"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Данные API · обновление каждые 5 секунд · журнал: последние {{ eventsStore.limit }} событий</span>
          <UButton label="Обновить" icon="i-lucide-refresh-cw" variant="outline" :loading="refreshing" @click="refresh" />
        </div>
        <UAlert v-if="dataErrors.length" color="error" title="Не удалось обновить данные" :description="dataErrors.join('; ')" />
        <p v-if="!auth.can('events:read')" class="text-sm text-muted">Нет права events:read для просмотра событий и графиков.</p>
        <template v-if="!fogMode">
          <div
            v-if="!settings.dashboard.length"
            class="flex min-h-64 items-center justify-center"
          >
            <div class="flex flex-col items-center gap-2 text-muted">
              <UIcon name="i-lucide-layout-dashboard" class="size-6" />
              <p class="text-xs">
                Ни один виджет не выбран — откройте «Настройки → Главный экран»
              </p>
            </div>
          </div>

          <div
            v-if="hasWidget('kpi')"
            class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <UCard
              v-for="item in dashboardKpis"
              :key="item.label"
              :ui="{ body: 'p-4' }"
            >
              <div class="flex items-center gap-3">
                <div
                  class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
                >
                  <UIcon :name="item.icon" class="size-4 text-primary" />
                </div>
                <div>
                  <p class="text-eyebrow">{{ item.label }}</p>
                  <p
                    class="mt-0.5 font-mono text-lg text-highlighted tabular-nums"
                  >
                    {{ item.value }}
                  </p>
                </div>
              </div>
            </UCard>
          </div>
        </template>

        <div class="grid gap-4 lg:grid-cols-3">
          <UCard
            v-if="hasWidget('activity') && auth.can('events:read')"
            class="lg:col-span-2"
            :ui="{ body: 'p-4', header: 'p-4 pb-0' }"
          >
            <template #header>
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="text-sm font-semibold text-highlighted">
                  События по минутам
                </h2>
                <span class="font-mono text-[11px] text-muted">
                  последние {{ eventsStore.limit }} событий
                </span>
              </div>
            </template>
            <DashboardChart
              v-if="eventsAvailable && eventsStore.events.length"
              type="line"
              :data="lineData"
              :options="lineOptions"
              :height="220"
            />
            <p v-else class="py-8 text-sm text-muted">{{ eventsStore.loading ? 'Загрузка событий…' : eventsStore.error ? 'Данные недоступны' : 'Пока нет событий' }}</p>
          </UCard>

          <UCard
            v-if="hasWidget('vectors') && auth.can('events:read')"
            :ui="{ body: 'p-4', header: 'p-4 pb-0' }"
          >
            <template #header>
              <h2 class="text-sm font-semibold text-highlighted">
                Типы событий за всё время
              </h2>
            </template>
            <DashboardChart
              v-if="eventsAvailable && eventsStore.stats?.total"
              type="doughnut"
              :data="donutData"
              :options="donutOptions"
              :height="220"
            />
            <p v-else class="py-8 text-sm text-muted">{{ eventsStore.loading ? 'Загрузка статистики…' : eventsStore.error ? 'Данные недоступны' : 'Пока нет событий' }}</p>
          </UCard>

          <UCard
            v-if="hasWidget('services') && auth.can('events:read')"
            class="lg:col-span-3"
            :ui="{ body: 'p-4', header: 'p-4 pb-0' }"
          >
            <template #header>
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="text-sm font-semibold text-highlighted">
                  События по сервисам за всё время
                </h2>
                <span class="font-mono text-[11px] text-muted">
                  топ-5 сервисов
                </span>
              </div>
            </template>
            <DashboardChart
              v-if="eventsAvailable && eventsStore.stats?.total"
              type="bar"
              :data="barData"
              :options="barOptions"
              :height="200"
            />
            <p v-else class="py-8 text-sm text-muted">{{ eventsStore.loading ? 'Загрузка статистики…' : eventsStore.error ? 'Данные недоступны' : 'Пока нет событий' }}</p>
          </UCard>

          <UCard
            v-if="hasWidget('events') && auth.can('events:read')"
            class="lg:col-span-3"
            :ui="{ body: 'p-2', header: 'p-4 pb-0' }"
          >
            <template #header>
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="text-sm font-semibold text-highlighted">
                  Последние события
                </h2>
                <span class="font-mono text-[11px] text-muted">
                  журнал · топ-6
                </span>
              </div>
            </template>
            <ul class="divide-y divide-default">
              <li
                v-for="event in latestEvents"
                :key="event.id"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2"
              >
                <span class="font-mono text-[11px] text-muted tabular-nums">
                  {{ formatDateTime(event.ts) }}
                </span>
                <UBadge
                  :color="severityColor[event.severity ?? ''] ?? 'neutral'"
                  variant="subtle"
                  size="sm"
                  :label="SEVERITY_LABELS[event.severity as keyof typeof SEVERITY_LABELS] ?? event.severity ?? 'Не определён'"
                />
                <span class="font-mono text-xs text-highlighted">
                  {{ event.src ?? '—' }}
                </span>
                <span class="text-xs text-toned">
                  {{ event.agent_id }} · {{ event.service }} · {{ event.event }}
                </span>
                <span
                  class="min-w-0 flex-1 truncate text-right text-xs text-muted"
                >
                  {{ event.data ? JSON.stringify(event.data) : '' }}
                </span>
              </li>
            </ul>
            <p v-if="!latestEvents.length" class="p-4 text-sm text-muted">{{ eventsStore.loading ? 'Загрузка событий…' : eventsStore.error ? 'Данные недоступны' : 'Пока нет событий' }}</p>
          </UCard>
        </div>
      </div>
    </section>
  </div>
</template>
