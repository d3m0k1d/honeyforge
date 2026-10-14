<script setup lang="ts">
import type { TrapProfile } from "~/types/traps";
import { LEVEL_BY_KEY, SERVICE_BY_KEY } from "~/utils/traps";

const props = defineProps<{ profile: TrapProfile; count: number }>();

const emit = defineEmits<{ (e: "configure", profile: TrapProfile): void }>();

const level = computed(() => LEVEL_BY_KEY[props.profile.level]);

function onConfigure() {
  emit("configure", props.profile);
}
</script>

<template>
  <UCard
    class="flex h-full flex-col transition-shadow hover:shadow-md"
    :ui="{ body: 'flex flex-1 flex-col gap-4' }"
  >
    <div class="flex items-start gap-3">
      <div
        class="flex size-11 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated"
      >
        <UIcon :name="profile.icon" class="size-5 text-primary" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-semibold text-highlighted">
            {{ profile.name }}
          </h3>
          <UBadge
            :color="level.color"
            variant="subtle"
            size="sm"
            :label="level.label"
          />
        </div>
        <p class="mt-0.5 text-xs text-muted">
          {{ profile.services.length }}
          {{ profile.services.length === 1 ? "сервис" : "сервиса" }} · шаблон
        </p>
      </div>
    </div>

    <p class="text-xs leading-relaxed text-toned">
      {{ profile.description }}
    </p>

    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="service in profile.services"
        :key="service.key"
        class="inline-flex items-center gap-1.5 rounded-md border border-default bg-elevated/60 px-2 py-1 text-[11px] text-toned"
      >
        <UIcon :name="SERVICE_BY_KEY[service.key].icon" class="size-3 text-muted" />
        {{ SERVICE_BY_KEY[service.key].label }}
        <span class="font-mono text-dimmed">{{ service.port }}</span>
      </span>
    </div>

    <div class="mt-auto flex flex-wrap gap-1.5">
      <span
        v-for="tag in profile.tags"
        :key="tag"
        class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-dimmed"
      >
        {{ tag }}
      </span>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted">
          ловушек: <span class="font-mono text-toned">{{ count }}</span>
        </span>
        <UButton
          class="cursor-pointer"
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-settings"
          label="Настроить"
          @click="onConfigure"
        />
      </div>
    </template>
  </UCard>
</template>
