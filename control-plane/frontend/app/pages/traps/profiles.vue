<script setup lang="ts">
definePageMeta({ permission: "deployments:read" });

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
          Типы ловушек из API. Выберите тип, агент и конфигурацию JSON.
        </p>
      </div>

      <UBadge color="neutral" variant="outline" size="lg">
        профилей: {{ store.pending || store.catalogueError ? '—' : cards.length }}
      </UBadge>
    </div>

    <UAlert v-if="store.catalogueError" color="error" :description="store.catalogueError" />
    <UButton label="Обновить" variant="outline" class="self-start" :loading="store.pending" @click="store.load()" />
    <p v-if="store.pending" role="status" class="text-sm text-muted">Загрузка каталога…</p>
    <p v-else-if="!store.catalogueError && !cards.length" class="text-sm text-muted">Каталог пуст</p>
    <div v-if="!store.pending && !store.catalogueError" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <TrapProfileCard
        v-for="card in cards"
        :key="card.profile.id"
        :profile="card.profile"
        :count="store.loaded ? card.count : null"
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
