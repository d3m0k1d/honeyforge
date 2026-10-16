<script setup lang="ts">
definePageMeta({ permission: "profiles:read" });

import type { TrapProfile } from "~/types/traps";

const store = useTrapsStore();
const auth = useAuthStore();

const canManage = computed(() => auth.can("deployments:manage"));

const selected = ref<TrapProfile | null>(null);
const formOpen = ref(false);

const cards = computed(() => store.profileCards);

onMounted(() => {
  store.load();
});

function configure(profile: TrapProfile) {
  if (!canManage.value) return;

  selected.value = profile;
  formOpen.value = true;
}

function onCreate(trapId: string) {
  formOpen.value = false;
  navigateTo(`/traps/${trapId}`);
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-arrow-left"
            label="К ловушкам"
            to="/traps"
          />
        </div>
        <p class="text-eyebrow mt-2">
          Каталог · Шаблоны развёртывания
        </p>
        <h1 class="mt-1 text-lg font-semibold tracking-tight text-highlighted">
          Профили ловушек
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Готовые шаблоны honeypot-сервисов. Выберите профиль, задайте порты,
          уровень эмуляции и агент — ловушка будет создана автоматически.
        </p>
      </div>

      <UBadge color="neutral" variant="outline" size="lg">
        профилей: {{ cards.length }}
      </UBadge>
    </div>

    <UAlert
      v-if="store.error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="store.error"
    />

    <div
      v-if="store.loading && !cards.length"
      class="flex items-center justify-center gap-2 rounded-lg border border-default py-10"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin text-dimmed"
      />
      <span class="text-xs text-muted">Загрузка профилей…</span>
    </div>

    <div
      v-else-if="!cards.length"
      class="rounded-lg border border-default px-4 py-10 text-center text-xs text-muted"
    >
      Профили не найдены — создайте их через API или назначьте агентам
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <TrapProfileCard
        v-for="card in cards"
        :key="card.profile.id"
        :profile="card.profile"
        :count="card.count"
        :can-configure="canManage"
        @configure="configure"
      />
    </div>

    <TrapProfileFormModal
      v-model:open="formOpen"
      :profile="selected"
      @created="onCreate"
    />
  </div>
</template>
