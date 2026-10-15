<script setup lang="ts">
definePageMeta({ permission: "honeypots:read" });

import type { Trap } from "~/types/traps";
import {
  AGENT_STATUS_BY_KEY,
  LEVEL_BY_KEY,
  formatDateTime,
  formatEvents,
  profileIconFor,
  serviceMeta,
  stateLabel,
} from "~/utils/traps";

const store = useTrapsStore();
const route = useRoute();
const toast = useToast();
const auth = useAuthStore();

const canManage = computed(() => auth.can("deployments:manage"));

const trapId = computed(() => String(route.params.id));
const trap = computed<Trap | null>(() => store.getTrap(trapId.value));

const deleteOpen = computed({
  get: () => Boolean(store.pendingDeleteId),
  set: (value) => {
    if (!value) store.cancelDelete();
  },
});

const profile = computed(() =>
  trap.value ? (store.profilesById[trap.value.profileId] ?? null) : null,
);
const agent = computed(() =>
  trap.value ? (store.agentsById[trap.value.agentId] ?? null) : null,
);
const level = computed(() =>
  trap.value ? (LEVEL_BY_KEY[trap.value.level] ?? LEVEL_BY_KEY.low) : null,
);
const status = computed(() =>
  trap.value
    ? AGENT_STATUS_BY_KEY[trap.value.agentStatus] ??
      AGENT_STATUS_BY_KEY.offline
    : null,
);

const trapIcon = computed(() => {
  if (!trap.value) return "i-lucide-shield-alert";

  return (
    store.profileIconById[trap.value.profileId] ??
    profileIconFor(trap.value.services.map((service) => service.key))
  );
});

const isRunning = computed(
  () => trap.value?.desiredState === "running" && !store.pending,
);

const severityColor: Record<string, "neutral" | "warning" | "error"> = {
  info: "neutral",
  warning: "warning",
  critical: "error",
};

onMounted(() => {
  store.load();
});

async function toggleStatus() {
  if (!trap.value || store.pending) return;

  const target = trap.value;
  const starting = target.desiredState !== "running";
  const updated = await store.runAction(
    target.id,
    starting ? "start" : "stop",
  );

  if (updated) {
    toast.add({
      title: starting
        ? `Ловушка ${target.name}: запуск`
        : `Ловушка ${target.name}: остановка`,
      description: "Команда поставлена в очередь агенту",
      color: starting ? "success" : "warning",
      icon: starting ? "i-lucide-play" : "i-lucide-circle-parking",
    });
    return;
  }

  if (store.error) {
    toast.add({
      title: "Команда не выполнена",
      description: store.error,
      color: "error",
      icon: "i-lucide-triangle-alert",
    });
  }
}

async function resync() {
  if (!trap.value || store.pending) return;

  const target = trap.value;
  const updated = await store.runAction(target.id, "reconcile");

  if (updated) {
    toast.add({
      title: `Ловушка ${target.name}: пересинхронизация`,
      description: "Команда reconcile поставлена в очередь",
      color: "success",
      icon: "i-lucide-refresh-cw",
    });
    return;
  }

  if (store.error) {
    toast.add({
      title: "Команда не выполнена",
      description: store.error,
      color: "error",
      icon: "i-lucide-triangle-alert",
    });
  }
}

async function confirmDelete() {
  const removed = await store.confirmDelete();

  deleteOpen.value = false;

  if (removed) {
    toast.add({
      title: `Ловушка ${removed.name} удалена`,
      color: "success",
      icon: "i-lucide-trash-2",
    });
    navigateTo("/traps");
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
  <div v-if="trap" class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <UButton
          class="cursor-pointer"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-arrow-left"
          label="К ловушкам"
          to="/traps"
        />

        <div class="mt-2 flex items-center gap-3">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated"
          >
            <UIcon :name="trapIcon" class="size-5 text-primary" />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-lg font-semibold tracking-tight text-highlighted">
                {{ trap.name }}
              </h1>
              <UBadge
                v-if="level"
                :color="level.color"
                variant="subtle"
                size="sm"
                :label="level.label"
              />
              <span
                class="inline-flex items-center gap-1.5 rounded-md border border-default px-2 py-0.5 text-[11px]"
              >
                <span
                  class="size-1.5 rounded-full"
                  :class="status?.dot"
                />
                <span class="text-toned">{{ status?.label }}</span>
              </span>
            </div>
            <p class="font-mono text-[10px] text-dimmed">
              {{ trap.honeypotType }} · создана {{ formatDateTime(trap.createdAt) }}
            </p>
          </div>
        </div>
      </div>

      <div v-if="canManage" class="flex flex-wrap gap-2">
        <UButton
          class="cursor-pointer"
          color="neutral"
          variant="outline"
          size="sm"
          :icon="isRunning ? 'i-lucide-circle-parking' : 'i-lucide-play'"
          :label="isRunning ? 'Остановить' : 'Запустить'"
          :loading="store.pending"
          @click="toggleStatus"
        />
        <UButton
          class="cursor-pointer"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Пересинхронизировать"
          :loading="store.pending"
          @click="resync"
        />
        <UButton
          class="cursor-pointer"
          color="error"
          variant="outline"
          size="sm"
          icon="i-lucide-trash-2"
          label="Удалить"
          @click="store.requestDelete(trap.id)"
        />
      </div>
    </div>

    <UAlert
      v-if="trap.lastError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Ошибка развёртывания"
      :description="trap.lastError"
    />

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-1">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-info" class="size-4 text-dimmed" />
            <h2 class="text-sm font-semibold text-highlighted">Обзор</h2>
          </div>
        </template>

        <p class="text-xs leading-relaxed text-toned">
          {{ trap.description || "Описание не заполнено" }}
        </p>

        <dl class="mt-4 space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Профиль</dt>
            <dd class="text-highlighted">
              {{ profile?.name ?? (trap.profileId || "—") }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Уровень</dt>
            <dd class="text-highlighted">{{ level?.label }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Тип</dt>
            <dd class="font-mono text-highlighted">{{ trap.honeypotType }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Драйвер</dt>
            <dd class="font-mono text-highlighted">{{ trap.driver }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Состояние</dt>
            <dd class="text-right text-highlighted">
              <template v-if="trap.desiredState === trap.observedState">
                {{ stateLabel(trap.observedState) }}
              </template>
              <template v-else>
                {{ stateLabel(trap.desiredState) }} →
                {{ stateLabel(trap.observedState) }}
              </template>
            </dd>
          </div>
          <div class="flex items-start justify-between gap-2">
            <dt class="text-muted">Порты</dt>
            <dd class="text-right font-mono text-highlighted">
              {{ trap.services.map((service) => service.port).join(", ") || "—" }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Агент</dt>
            <dd class="font-mono text-highlighted">{{ trap.agentId }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">События</dt>
            <dd class="font-mono text-primary tabular-nums">
              {{ formatEvents(trap.eventsCount) }}
            </dd>
          </div>
        </dl>

        <div
          v-if="level?.description"
          class="mt-4 rounded-md border border-default bg-elevated/60 p-2.5 text-[11px] text-muted"
        >
          {{ level.description }}
        </div>
      </UCard>

      <UCard class="lg:col-span-1">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-server" class="size-4 text-dimmed" />
            <h2 class="text-sm font-semibold text-highlighted">Агент</h2>
          </div>
        </template>

        <div class="flex items-center gap-3">
          <span
            class="size-2 rounded-full"
            :class="status?.dot ?? 'bg-dimmed'"
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ agent?.agent_id ?? trap.agentId }}
            </p>
            <p class="font-mono text-[10px] text-dimmed">
              {{ agent?.online ? "online" : agent ? "offline" : "не найден" }}
            </p>
          </div>
        </div>

        <dl class="mt-4 space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Статус</dt>
            <dd class="text-highlighted">{{ status?.label }}</dd>
          </div>
          <div class="flex items-start justify-between gap-2">
            <dt class="text-muted">Heartbeat</dt>
            <dd class="text-right font-mono text-highlighted">
              {{ agent?.last_heartbeat_at ? formatDateTime(agent.last_heartbeat_at) : "—" }}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-2">
            <dt class="text-muted">Enroll</dt>
            <dd class="text-right font-mono text-highlighted">
              {{ agent?.enrolled_at ? formatDateTime(agent.enrolled_at) : "—" }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-muted">Профиль агента</dt>
            <dd class="text-highlighted">
              {{ agent?.profile_name ?? "—" }}
            </dd>
          </div>
        </dl>

        <UButton
          v-if="canManage"
          class="mt-4 cursor-pointer"
          color="neutral"
          variant="outline"
          size="sm"
          block
          icon="i-lucide-refresh-cw"
          label="Пересинхронизировать"
          :loading="store.pending"
          @click="resync"
        />
      </UCard>

      <UCard class="lg:col-span-1">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-plug" class="size-4 text-dimmed" />
            <h2 class="text-sm font-semibold text-highlighted">Сервисы</h2>
          </div>
        </template>

        <div v-if="trap.services.length" class="space-y-1.5">
          <div
            v-for="service in trap.services"
            :key="service.key"
            class="flex items-center gap-3 rounded-md border border-default px-3 py-2"
          >
            <UIcon
              :name="serviceMeta(service.key).icon"
              class="size-4 text-dimmed"
            />
            <span class="text-sm text-highlighted">
              {{ serviceMeta(service.key).label }}
            </span>
            <span class="ml-auto font-mono text-xs text-toned tabular-nums">
              :{{ service.port }}
            </span>
          </div>
        </div>

        <div
          v-else
          class="py-6 text-center text-xs text-dimmed"
        >
          <p>Виртуальная машина (QEMU)</p>
          <p class="mt-1 font-mono">{{ trap.honeypotType }}</p>
        </div>
      </UCard>

      <UCard class="lg:col-span-3">
        <template #header>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-scroll-text" class="size-4 text-dimmed" />
              <h2 class="text-sm font-semibold text-highlighted">
                Последние события
              </h2>
            </div>
            <span class="font-mono text-[11px] text-muted">
              всего {{ trap.eventsCount.toLocaleString("ru-RU") }}
            </span>
          </div>
        </template>

        <div class="divide-y divide-default rounded-lg border border-default">
          <div
            v-for="event in trap.events"
            :key="event.id"
            class="flex flex-wrap items-center gap-3 px-3 py-2"
          >
            <span class="font-mono text-[11px] text-dimmed">
              {{ formatDateTime(event.ts) }}
            </span>
            <UBadge
              :color="severityColor[event.severity]"
              variant="subtle"
              size="sm"
              :label="serviceMeta(event.service).label"
            />
            <span class="font-mono text-[11px] text-muted">
              {{ event.source }}
            </span>
            <span class="min-w-0 flex-1 truncate text-xs text-toned">
              {{ event.message }}
            </span>
          </div>

          <div
            v-if="!trap.events.length"
            class="px-3 py-8 text-center text-xs text-dimmed"
          >
            Событий пока нет — ловушка только что создана
          </div>
        </div>
      </UCard>
    </div>

    <UModal
      v-model:open="deleteOpen"
      title="Удалить ловушку?"
      description="Действие необратимо"
      :ui="{ content: 'max-w-md' }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            label="Отмена"
            @click="store.cancelDelete()"
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

  <div v-else class="flex flex-col items-center gap-4 py-20 text-center">
    <div
      class="flex size-12 items-center justify-center rounded-lg border border-default bg-elevated"
    >
      <UIcon
        :name="store.loading ? 'i-lucide-loader-circle' : 'i-lucide-triangle-alert'"
        class="size-6 text-dimmed"
        :class="store.loading ? 'animate-spin' : ''"
      />
    </div>
    <div>
      <h1 class="text-sm font-semibold text-highlighted">
        {{ store.loading ? "Загрузка…" : "Ловушка не найдена" }}
      </h1>
      <p class="mt-1 text-xs text-muted">
        {{
          store.loading
            ? "Получаем данные с control plane"
            : "Возможно, она была удалена или никогда не существовала"
        }}
      </p>
    </div>
    <UButton
      class="cursor-pointer"
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-arrow-left"
      label="К списку ловушек"
      to="/traps"
    />
  </div>
</template>
