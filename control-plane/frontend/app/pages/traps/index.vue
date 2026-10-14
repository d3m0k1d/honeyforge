<script setup lang="ts">
import { PROFILES } from "~/utils/traps";

const store = useTrapsStore();
const toast = useToast();

const deleteOpen = computed({
  get: () => Boolean(store.pendingDeleteId),
  set: (value) => {
    if (!value) store.cancelDelete();
  },
});

const stats = computed(() => [
  {
    label: "Ловушек",
    value: String(store.traps.length),
    icon: "i-lucide-radar",
  },
  {
    label: "Агентов онлайн",
    value: String(store.onlineCount),
    icon: "i-lucide-radio",
  },
  {
    label: "Событий captured",
    value: store.totalEvents.toLocaleString("ru-RU"),
    icon: "i-lucide-activity",
  },
  {
    label: "Профилей",
    value: String(PROFILES.length),
    icon: "i-lucide-blocks",
  },
]);

const deletingIcon = computed(
  () =>
    PROFILES.find((profile) => profile.id === store.deletingTrap?.profileId)
      ?.icon ?? "i-lucide-radar",
);

onMounted(() => {
  store.load();
});

function confirmDelete() {
  const removed = store.confirmDelete();

  if (removed) {
    toast.add({
      title: `Ловушка ${removed.name} удалена`,
      color: "success",
      icon: "i-lucide-trash-2",
    });
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-eyebrow">
          Мониторинг · HoneypotForge
        </p>
        <h1 class="mt-1 text-lg font-semibold tracking-tight text-highlighted">
          Ловушки
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Настроенные honeypot-ловушки платформы: сервисы, порты, уровень
          эмуляции, состояние агентов и количество перехваченных событий.
        </p>
      </div>

      <UButton
        class="cursor-pointer"
        icon="i-lucide-plus"
        label="Создать ловушку"
        to="/traps/profiles"
      />
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
            <p class="text-eyebrow">
              {{ item.label }}
            </p>
            <p class="mt-0.5 font-mono text-lg text-highlighted tabular-nums">
              {{ item.value }}
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <TrapsToolbar />

    <TrapsTable />

    <UModal
      v-model:open="deleteOpen"
      title="Удалить ловушку?"
      description="Действие необратимо: события и конфигурация будут потеряны"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <div
          v-if="store.deletingTrap"
          class="flex items-center gap-3 rounded-lg border border-default bg-elevated/60 p-3"
        >
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon :name="deletingIcon" class="size-4 text-primary" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ store.deletingTrap.name }}
            </p>
            <p class="font-mono text-[10px] text-dimmed">
              {{ store.deletingTrap.id }}
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            label="Отмена"
            @click="deleteOpen = false"
          />
          <UButton
            class="cursor-pointer"
            color="error"
            icon="i-lucide-trash-2"
            label="Удалить"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
