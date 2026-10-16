<script setup lang="ts">
definePageMeta({ permission: "deployments:read" });

const store = useTrapsStore();
const agents = useAgentsStore();
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
    value: store.loaded && !store.error ? String(store.traps.length) : "—",
    icon: "i-lucide-radar",
  },
  {
    label: "Агентов онлайн",
    value: store.onlineCount === null ? "—" : String(store.onlineCount),
    icon: "i-lucide-radio",
  },
  {
    label: "События по ловушкам",
    value: "Недоступно",
    icon: "i-lucide-activity",
  },
  {
    label: "Профилей",
    value: !store.loaded || store.catalogueError ? "—" : String(store.profiles.length),
    icon: "i-lucide-blocks",
  },
]);

const deletingIcon = computed(
  () =>
    store.profiles.find((profile) => profile.id === store.deletingTrap?.profileId)
      ?.icon ?? "i-lucide-radar",
);

onMounted(() => {
  store.load();
});

async function confirmDelete() {
  const removed = await store.confirmDelete();

  if (removed) {
    toast.add({
      title: `Запрошено уничтожение: ${removed.name}`,
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
          Настроенные honeypot-ловушки платформы: сервисы, порты, уровень
          эмуляции и состояние агентов. API не предоставляет события по отдельной ловушке.
        </p>
      </div>

      <UButton
        v-if="store.canManage"
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

    <UAlert v-if="store.error" color="error" title="Не удалось загрузить ловушки" :description="store.error" />
    <UAlert v-if="agents.error" color="warning" title="Данные агентов недоступны" :description="agents.error" />
    <UAlert v-if="store.catalogueError" color="warning" title="Каталог недоступен" :description="store.catalogueError" />
    <UButton label="Обновить" icon="i-lucide-refresh-cw" variant="outline" class="self-start" :loading="store.pending" @click="store.load()" />
    <p v-if="store.pending" role="status" class="text-sm text-muted">Загрузка ловушек…</p>
    <TrapsToolbar v-if="!store.pending && !store.error" />

    <TrapsTable v-if="store.loaded && !store.error" />

    <UModal
      v-model:open="deleteOpen"
      title="Уничтожить ловушку?"
      description="API поставит команду destroy в очередь. Запись развёртывания сохранится."
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <UAlert v-if="store.actionError" color="error" :description="store.actionError" class="mb-3" />
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
            label="Уничтожить"
            :loading="Boolean(store.actionPending)"
            :disabled="!store.canManage || Boolean(store.actionPending)"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
