<script setup lang="ts">
import type { ServiceKey, TrapSort } from "~/types/traps";
import { SERVICES, TRAP_FIELDS } from "~/utils/traps";

const store = useTrapsStore();

const sortItems = [
  { label: "События", value: "events" },
  { label: "Название", value: "name" },
  { label: "Профиль", value: "profile" },
  { label: "Уровень", value: "level" },
  { label: "Порт", value: "port" },
  { label: "Агент", value: "agent" },
  { label: "Дата создания", value: "createdAt" },
];

const levelItems = [
  { label: "Все уровни", value: "all" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const agentItems = [
  { label: "Любой статус", value: "all" },
  { label: "Online", value: "online" },
  { label: "Синхронизация", value: "syncing" },
  { label: "Offline", value: "offline" },
  { label: "Ошибка", value: "error" },
];

const visibleCount = computed(
  () => TRAP_FIELDS.filter((field) => store.fieldVisibility[field.key]).length,
);

const directionIcon = computed(() =>
  store.sort.direction === "asc"
    ? "i-lucide-arrow-up-narrow-wide"
    : "i-lucide-arrow-down-wide-narrow",
);

function onSortSelect(field: string) {
  store.toggleSort(field as TrapSort["field"]);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-radial-ignore>
    <UInput
      :model-value="store.search"
      icon="i-lucide-search"
      placeholder="Поиск по названию, профилю, агенту, порту…"
      class="min-w-56 flex-1"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setSearch($event as string)"
    />

    <USelect
      :model-value="store.levelFilter"
      :items="levelItems"
      icon="i-lucide-gauge"
      class="w-40"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="store.setLevelFilter($event as 'all' | 'low' | 'medium' | 'high')"
    />

    <USelect
      :model-value="store.agentFilter"
      :items="agentItems"
      icon="i-lucide-radio"
      class="w-44"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="
        store.setAgentFilter($event as 'all' | 'online' | 'syncing' | 'offline' | 'error')
      "
    />

    <USelect
      :model-value="store.sort.field"
      :items="sortItems"
      icon="i-lucide-arrow-up-down"
      class="w-44"
      :ui="{ leading: 'pointer-events-none' }"
      @update:model-value="onSortSelect($event)"
    />

    <UButton
      class="cursor-pointer"
      color="neutral"
      variant="outline"
      size="sm"
      :icon="directionIcon"
      :label="store.sort.direction === 'asc' ? 'возр.' : 'убыв.'"
      @click="store.toggleSort(store.sort.field)"
    />

    <UPopover :content="{ align: 'end', side: 'bottom', sideOffset: 10 }">
      <UButton
        class="cursor-pointer"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-sliders-horizontal"
        :label="`Поля · ${visibleCount}`"
        trailing-icon="i-lucide-chevron-down"
      />

      <template #content>
        <div class="w-64 space-y-4 p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-eyebrow">
              Колонки таблицы
            </span>
            <UButton
              class="cursor-pointer"
              color="neutral"
              variant="ghost"
              size="xs"
              label="Сбросить"
              @click="store.resetFields()"
            />
          </div>

          <div class="space-y-1">
            <UCheckbox
              v-for="field in TRAP_FIELDS"
              :key="field.key"
              :model-value="store.fieldVisibility[field.key]"
              :label="field.label"
              :disabled="field.locked"
              @update:model-value="store.toggleField(field.key)"
            />
          </div>

          <div class="space-y-2 border-t border-default pt-3">
            <span class="text-eyebrow">
              Сервисы в колонке
            </span>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1">
              <UCheckbox
                v-for="service in SERVICES"
                :key="service.key"
                :model-value="store.serviceVisibility[service.key]"
                :label="service.short"
                @update:model-value="store.setServiceVisibility(service.key, $event as boolean)"
              />
            </div>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
