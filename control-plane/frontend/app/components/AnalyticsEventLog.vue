<script setup lang="ts">
import type { AnalyticsSortKey, AnalyticsEvent } from "~/stores/analytics";
import { JOURNAL_PAGE_SIZE } from "~/stores/analytics";
import {
  SEVERITY_LABELS,
  actionLabel,
  formatDateTime,
  serviceMeta,
} from "~/utils/traps";

const store = useAnalyticsStore();

const pageSize = JOURNAL_PAGE_SIZE;

const total = computed(() => store.journalTotal);

const pages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
);

const pageRows = computed(() => store.journalSorted);

const page = computed({
  get: () => store.page,
  set: (value: number) => {
    void store.setPage(value);
  },
});

const severityColor: Record<string, "neutral" | "warning" | "error"> = {
  info: "neutral",
  warning: "warning",
  critical: "error",
};

const sortColumns: { key: AnalyticsSortKey; label: string }[] = [
  { key: "ts", label: "Время" },
  { key: "source", label: "IP атакующего" },
  { key: "trap", label: "Ловушка" },
  { key: "service", label: "Протокол" },
  { key: "action", label: "Действие" },
  { key: "severity", label: "Приоритет" },
];

function indicator(key: AnalyticsSortKey) {
  if (store.sort.field !== key) return "";

  return store.sort.direction === "asc"
    ? "i-lucide-chevron-up"
    : "i-lucide-chevron-down";
}

function onSort(key: AnalyticsSortKey) {
  store.setSort(key);
}

function onRowClick(event: AnalyticsEvent) {
  store.setTrap(event.trapId);
  store.setSearch(event.source);
  navigateTo("/analytics");
}

const rangeStart = computed(() =>
  total.value ? (page.value - 1) * pageSize + 1 : 0,
);

const rangeEnd = computed(() =>
  Math.min(page.value * pageSize, total.value),
);
</script>

<template>
  <div
    class="overflow-x-auto rounded-lg border border-default bg-default/95 shadow-sm"
  >
    <table class="w-full text-left text-sm">
      <thead class="border-b border-default bg-muted/40">
        <tr>
          <th
            v-for="column in sortColumns"
            :key="column.key"
            class="whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted"
          >
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded transition-colors hover:text-highlighted"
              :class="indicator(column.key) ? 'text-highlighted' : ''"
              @click="onSort(column.key)"
            >
              {{ column.label }}
              <UIcon
                v-if="indicator(column.key)"
                :name="indicator(column.key)"
                class="size-3.5"
              />
            </button>
          </th>
          <th
            class="whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted"
          >
            Сообщение
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="event in pageRows"
          :key="event.id"
          class="border-b border-default transition-colors last:border-0 hover:bg-elevated/60"
        >
          <td class="px-4 py-2.5 font-mono text-xs text-toned tabular-nums">
            {{ formatDateTime(event.ts) }}
          </td>

          <td class="px-4 py-2.5 font-mono text-xs text-highlighted">
            {{ event.source }}
          </td>

          <td class="px-4 py-2.5">
            <button
              type="button"
              class="cursor-pointer rounded text-xs text-toned transition-colors hover:text-primary"
              @click="onRowClick(event)"
            >
              {{ event.trapName }}
            </button>
          </td>

          <td class="px-4 py-2.5">
            <span
              class="inline-flex items-center gap-1.5 rounded-md border border-default bg-elevated/60 px-1.5 py-0.5 text-[11px] text-toned"
            >
              <UIcon
                :name="serviceMeta(event.service).icon"
                class="size-3 text-muted"
              />
              {{ serviceMeta(event.service).label }}
              <span class="font-mono text-dimmed">{{ event.port }}</span>
            </span>
          </td>

          <td class="px-4 py-2.5 text-xs text-toned">
            {{ actionLabel(event.action) }}
          </td>

          <td class="px-4 py-2.5">
            <UBadge
              :color="severityColor[event.severity]"
              variant="subtle"
              size="sm"
              :label="SEVERITY_LABELS[event.severity]"
            />
          </td>

          <td class="max-w-72 px-4 py-2.5">
            <p class="truncate text-xs text-muted" :title="event.message">
              {{ event.message }}
            </p>
          </td>
        </tr>

        <tr v-if="!total">
          <td colspan="7" class="px-4 py-12 text-center">
            <div class="flex flex-col items-center gap-3">
              <div
                class="flex size-11 items-center justify-center rounded-lg border border-default bg-elevated"
              >
                <UIcon name="i-lucide-list-filter" class="size-5 text-dimmed" />
              </div>
              <div>
                <p class="text-sm font-semibold text-highlighted">
                  Событий не найдено
                </p>
                <p class="mt-1 text-xs text-muted">
                  Измените фильтры или период
                </p>
              </div>
              <UButton
                class="cursor-pointer"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-rotate-ccw"
                label="Сбросить фильтры"
                @click="store.reset()"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-t border-default px-4 py-2.5 text-xs text-muted"
    >
      <span>
        Показано {{ rangeStart }}–{{ rangeEnd }} из
        <span class="font-mono text-toned">{{ total }}</span>
      </span>

      <UPagination
        v-if="pages > 1"
        v-model:page="page"
        :total="total"
        :page-count="pageSize"
        :sibling-count="1"
        show-edges
        size="sm"
        class="data-radial-ignore"
        :ui="{
          list: 'gap-1',
          first: 'cursor-pointer',
          prev: 'cursor-pointer',
          next: 'cursor-pointer',
          last: 'cursor-pointer',
        }"
      />
    </div>
  </div>
</template>
