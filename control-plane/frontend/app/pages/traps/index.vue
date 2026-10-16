<script setup lang="ts">
definePageMeta({ permission: "honeypots:read" });

import { profileIconFor } from "~/utils/traps";

const store = useTrapsStore();
const toast = useToast();
const auth = useAuthStore();

const canManage = computed(() => auth.can("deployments:manage"));

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
    value: String(store.profiles.length),
    icon: "i-lucide-blocks",
  },
]);

const deletingIcon = computed(() => {
  const trap = store.deletingTrap;
  if (!trap) return "i-lucide-radar";

  return (
    store.profileIconById[trap.profileId] ??
    profileIconFor(trap.services.map((service) => service.key))
  );
});

onMounted(() => {
  store.load();
});

async function confirmDelete() {
  const removed = await store.confirmDelete();

  deleteOpen.value = false;

  if (removed) {
    toast.add({
      title: `Ловушка ${removed.name} удалена`,
      color: "success",
      icon: "i-lucide-trash-2",
    });
    return;
  }

  if (store.error) {
    toast.add({
      title: "Не удалось удалить ловушку",
      description: store.error,
      color: "error",
      icon: "i-lucide-triangle-alert",
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
          Развёрнутые honeypot-ловушки платформы: сервисы, порты, уровень
          эмуляции, состояние агентов и количество перехваченных событий.
        </p>
      </div>

      <UButton
        v-if="canManage"
        class="cursor-pointer"
        icon="i-lucide-plus"
        label="Создать ловушку"
        to="/traps/profiles"
      />
    </div>

    <UAlert
      v-if="store.error && !store.pending"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="store.error"
    >
      <template #actions>
        <UButton
          class="cursor-pointer"
          color="error"
          variant="soft"
          size="xs"
          icon="i-lucide-refresh-cw"
          label="Повторить"
          @click="store.load(true)"
        />
      </template>
    </UAlert>

    <div
      v-if="store.loading && !store.traps.length"
      class="flex items-center justify-center gap-2 rounded-lg border border-default py-10"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin text-dimmed"
      />
      <span class="text-xs text-muted">Загрузка ловушек…</span>
    </div>

    <template v-else>
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
    </template>

    <UModal
      v-model:open="deleteOpen"
      title="Удалить ловушку?"
      description="Действие необратимо: конфигурация будет уничтожена"
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
              {{ store.deletingTrap.honeypotType }}
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
            :loading="store.pending"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
