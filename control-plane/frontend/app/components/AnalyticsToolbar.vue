<script setup lang="ts">
import { exportData } from "~/utils/export";
import { PERIODS } from "~/stores/analytics";

const store = useAnalyticsStore();
const toast = useToast();

const allOption = { label: "Все", value: "all" };

const options = (values: string[]) => [
  allOption,
  ...[...new Set(values)].sort().map((value) => ({ label: value, value })),
];
const serviceItems = computed(() => options(store.baseEvents.map((event) => event.service)));
const actionItems = computed(() => options(store.baseEvents.map((event) => event.action)));
const severityItems = computed(() => options(store.baseEvents.map((event) => event.severity)));

const periodItems = PERIODS.map((item) => ({
  label: item.label,
  value: item.key,
}));

const exportItems = computed(() => [
  {
    label: `Выгрузить ${store.sortedEvents.length} событий`,
    type: "label" as const,
    class: "text-dimmed",
  },
  { type: "separator" as const },
  {
    label: "CSV · запятая",
    icon: "i-lucide-file",
    onSelect: () => runExport("csv"),
  },
  {
    label: "TSV · табуляция",
    icon: "i-lucide-table-2",
    onSelect: () => runExport("tsv"),
  },
  {
    label: "TXT · текст",
    icon: "i-lucide-file-text",
    onSelect: () => runExport("txt"),
  },
  {
    label: "JSON",
    icon: "i-lucide-file-json",
    onSelect: () => runExport("json"),
  },
  {
    label: "XML",
    icon: "i-lucide-file-code",
    onSelect: () => runExport("xml"),
  },
  {
    label: "Excel (XLS)",
    icon: "i-lucide-file-spreadsheet",
    onSelect: () => runExport("xls"),
  },
]);

const exportEmpty = computed(() => store.sortedEvents.length === 0);

function runExport(format: "csv" | "tsv" | "txt" | "json" | "xml" | "xls") {
  const base = "events-latest-filtered";

  exportData(
    store.sortedEvents,
    [
      { key: "ts", label: "Время", value: (row) => row.ts },
      { key: "source", label: "IP атакующего", value: (row) => row.source },
      { key: "agent_id", label: "Agent ID", value: (row) => row.agent_id },
      { key: "service", label: "Протокол", value: (row) => row.service },
      { key: "port", label: "Порт", value: (row) => row.port ?? "" },
      { key: "action", label: "Действие", value: (row) => row.action },
      { key: "severity", label: "Приоритет", value: (row) => row.severity },
      { key: "message", label: "Сообщение", value: (row) => row.message },
    ],
    format,
    base,
  );

  toast.add({
    title: `Экспорт завершён`,
    description: `${store.sortedEvents.length} событий · ${format.toUpperCase()}`,
    color: "success",
    icon: "i-lucide-download",
  });
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2"
    data-radial-ignore
  >
    <USelect
      :model-value="store.agentId ?? 'all'"
      :items="[{ label: 'Все агенты', value: 'all' }, ...store.agentOptions]"
      aria-label="Агент"
      icon="i-lucide-radar"
      class="w-52"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setAgent($event === 'all' ? null : String($event))"
    />

    <USelect
      :model-value="store.period"
      :items="periodItems"
      aria-label="Период"
      icon="i-lucide-clock"
      class="w-48"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setPeriod($event as typeof store.period)"
    />

    <UInput
      :model-value="store.search"
      icon="i-lucide-search"
      placeholder="IP, сообщение, действие…"
      aria-label="Поиск по источнику и данным"
      class="min-w-48 flex-1"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setSearch($event as string)"
    />

    <USelect
      :model-value="store.serviceFilter"
      :items="serviceItems"
      aria-label="Протокол"
      icon="i-lucide-globe"
      class="w-40"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setServiceFilter(String($event))"
    />

    <USelect
      :model-value="store.actionFilter"
      :items="actionItems"
      aria-label="Тип события"
      icon="i-lucide-target"
      class="w-56"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setActionFilter(String($event))"
    />

    <USelect
      :model-value="store.severityFilter"
      :items="severityItems"
      aria-label="Приоритет"
      icon="i-lucide-shield-alert"
      class="w-44"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setSeverityFilter(String($event))"
    />

    <UButton
      class="cursor-pointer"
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-rotate-ccw"
      label="Сброс"
      @click="store.reset()"
    />

    <UDropdownMenu
      :items="exportItems"
      :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
      :ui="{ content: 'w-56', item: 'cursor-pointer' }"
    >
      <UButton
        class="cursor-pointer"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-download"
        label="Экспорт"
        trailing-icon="i-lucide-chevron-down"
        :disabled="exportEmpty"
      />
    </UDropdownMenu>
  </div>
</template>
