<script setup lang="ts">
import type { ServiceKey, TrapLevel, TrapProfile } from "~/types/traps";
import {
  AGENTS,
  AGENT_STATUSES,
  LEVELS,
  SERVICES,
  SERVICE_BY_KEY,
} from "~/utils/traps";

const props = defineProps<{
  open: boolean;
  profile: TrapProfile | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", trapId: string): void;
}>();

const store = useTrapsStore();
const toast = useToast();

const open = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const name = ref("");
const description = ref("");
const level = ref<TrapLevel>("medium");
const agentId = ref(AGENTS[0]!.id);
const agentStatus = ref<"online" | "syncing">("online");
const services = ref<{ key: ServiceKey; port: number; enabled: boolean }[]>([]);

const levelItems = LEVELS.map((item) => ({
  label: item.label,
  description: item.description,
  value: item.key,
}));

const agentItems = AGENTS.map((agent) => ({
  label: `${agent.name} · ${agent.host}`,
  value: agent.id,
}));

const statusItems = AGENT_STATUSES.filter(
  (status) => status.key === "online" || status.key === "syncing",
).map((status) => ({ label: status.label, value: status.key }));

const selectedServices = computed(() =>
  services.value.filter((service) => service.enabled),
);

const canSubmit = computed(
  () => Boolean(name.value.trim()) && selectedServices.value.length > 0,
);

function resetForm() {
  const profile = props.profile;

  if (!profile) {
    name.value = "";
    description.value = "";
    services.value = [];
    return;
  }

  name.value = `${profile.id}-${Math.random().toString(36).slice(2, 6)}`;
  description.value = profile.description;
  level.value = profile.level;

  services.value = SERVICES.map((service) => {
    const preset = profile.services.find((item) => item.key === service.key);

    return {
      key: service.key,
      port: preset?.port ?? service.defaultPort,
      enabled: Boolean(preset),
    };
  });
}

watch(
  () => [props.open, props.profile?.id] as const,
  ([isOpen]) => {
    if (isOpen) resetForm();
  },
  { immediate: true },
);

function submit() {  if (!props.profile || !canSubmit.value) return;

  const created = store.createTrap({
    profileId: props.profile.id,
    name: name.value,
    description: description.value,
    level: level.value,
    agentId: agentId.value,
    agentStatus: agentStatus.value,
    services: selectedServices.value.map((service) => ({
      key: service.key,
      port: service.port,
    })),
  });

  toast.add({
    title: `Ловушка ${created.name} создана`,
    description: `Профиль: ${props.profile.name}`,
    color: "success",
    icon: "i-lucide-check",
  });

  open.value = false;
  emit("created", created.id);
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="profile ? `Настройка · ${profile.name}` : 'Настройка профиля'"
    description="Задайте параметры и сервисы — ловушка будет создана сразу"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div v-if="profile" class="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        <div class="flex items-start gap-3">
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated"
          >
            <UIcon :name="profile.icon" class="size-5 text-primary" />
          </div>
          <p class="text-xs leading-relaxed text-toned">
            {{ profile.description }}
          </p>
        </div>

        <UFormField label="Название ловушки" required>
          <UInput
            v-model="name"
            placeholder="например, corp-portal-prod"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Описание">
          <UTextarea
            v-model="description"
            :rows="2"
            placeholder="Зачем нужна ловушка и что ожидаем поймать"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Уровень эмуляции" hint="Насколько детально эмулируется сервис">
            <USelect
              v-model="level"
              :items="levelItems"
              icon="i-lucide-gauge"
              class="w-full"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Агент размещения">
            <USelect
              v-model="agentId"
              :items="agentItems"
              icon="i-lucide-server"
              class="w-full"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>
        </div>

        <UFormField label="Стартовый статус">
          <URadioGroup
            v-model="agentStatus"
            :items="statusItems"
            variant="list"
            size="sm"
          />
        </UFormField>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-eyebrow">
              Сервисы и порты
            </span>
            <span class="text-xs text-dimmed">
              выбрано: {{ selectedServices.length }}
            </span>
          </div>

          <div class="space-y-1.5">
            <div
              v-for="(service, index) in services"
              :key="service.key"
              class="flex flex-wrap items-center gap-3 rounded-md border border-default px-3 py-2 transition-colors"
              :class="service.enabled ? 'bg-elevated/60' : 'opacity-70'"
            >
              <UCheckbox
                :model-value="service.enabled"
                :label="SERVICE_BY_KEY[service.key].label"
                @update:model-value="services[index]!.enabled = $event as boolean"
              />

              <UIcon
                :name="SERVICE_BY_KEY[service.key].icon"
                class="size-4 text-dimmed"
              />

              <div class="ml-auto flex items-center gap-2">
                <span class="text-xs text-muted">порт</span>
                <UInput
                  :model-value="service.port"
                  type="number"
                  size="sm"
                  class="w-24 font-mono"
                  :disabled="!service.enabled"
                  @update:model-value="
                    services[index]!.port = Number($event) || 0
                  "
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <span class="text-xs text-dimmed">
          шаблон: <span class="font-mono">{{ profile?.id }}</span>
        </span>
        <div class="flex gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            label="Отмена"
            @click="open = false"
          />
          <UButton
            class="cursor-pointer"
            icon="i-lucide-plus"
            label="Создать ловушку"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
