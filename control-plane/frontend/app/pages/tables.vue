<script setup lang="ts">
import type { TabKey } from "~/types/database";

definePageMeta({ layout: "tables", permission: "databases:read" });

const store = useTablesStore();

const tabs = [
  {
    label: "Конструктор",
    value: "constructor",
    icon: "i-lucide-blocks",
    slot: "constructor",
  },
  { label: "Данные", value: "data", icon: "i-lucide-table", slot: "data" },
  { label: "Редактор", value: "editor", icon: "i-lucide-terminal", slot: "editor" },
];

const tab = computed({
  get: () => store.activeTab,
  set: (value) => store.setActiveTab(value as TabKey),
});
</script>

<template>
  <div class="flex h-full flex-col gap-5">
    <div class="border-b border-default pb-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-lg font-semibold tracking-tight text-highlighted">
          Конструктор БД
        </h1>
        <div class="flex items-center gap-2">
          <UBadge v-if="store.saving" color="neutral" variant="subtle" size="sm">
            Сохранение…
          </UBadge>
          <UBadge color="neutral" variant="outline" size="sm">
            {{ store.workspaceName }}
          </UBadge>
        </div>
      </div>
      <p class="text-eyebrow mt-1">
        Схема · Данные · SQL
      </p>
    </div>

    <UAlert
      v-if="store.error"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      title="Не удалось сохранить схему"
      :description="store.error"
    />

    <div
      v-if="store.loading && !store.tables.length"
      class="flex min-h-40 items-center justify-center text-sm text-muted"
    >
      Загрузка схемы…
    </div>

    <div class="rounded-lg border border-default bg-default/95 shadow-sm">
      <div class="border-b border-default px-4 py-3 sm:px-5">
        <UTabs
          v-model="tab"
          :items="tabs"
          :unmount-on-hide="false"
          :ui="{
            list: 'w-full bg-muted/40 border border-default rounded-lg p-0.5',
            trigger: 'flex-1 justify-center gap-1.5 text-xs uppercase tracking-[0.14em]',
            content: 'p-4 sm:p-5',
          }"
        >
          <template #constructor>
            <SchemaCanvas />
          </template>
          <template #data>
            <TableDataGrid />
          </template>
          <template #editor>
            <SqlEditor />
          </template>
        </UTabs>
      </div>
    </div>
  </div>
</template>
