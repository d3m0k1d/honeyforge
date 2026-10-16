<script setup lang="ts">
import type { ServiceKey, TrapLevel, TrapProfile } from "~/types/traps";
import { LEVELS, SERVICES, serviceMeta } from "~/utils/traps";

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
const auth = useAuthStore();

const canManage = computed(() => auth.can("deployments:manage"));

const open = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const name = ref("");
const level = ref<TrapLevel>("medium");
const agentId = ref("");
const image = ref("");
const services = ref<{ key: ServiceKey; port: number; enabled: boolean }[]>([]);

const levelItems = LEVELS.map((item) => ({
  label: item.label,
  description: item.description,
  value: item.key,
}));

const agentItems = computed(() =>
  store.enrolledAgents.map((agent) => ({
    label: `${agent.agent_id} · ${agent.online ? "online" : "offline"}`,
    value: agent.agent_id,
  })),
);

const imageItems = computed(() =>
  store.qemuImages.map((item) => ({
    label: `${item.name} · ${(item.size_bytes / 1024 / 1024).toFixed(0)} МБ`,
    value: item.name,
  })),
);

const selectedServices = computed(() =>
  services.value.filter((service) => service.enabled),
);

const isHigh = computed(() => level.value === "high");

function serviceAvailable(key: ServiceKey) {
  if (isHigh.value) return false;

  return store.isServiceAvailable(key, level.value);
}

const canSubmit = computed(() => {
  if (!canManage.value || !name.value.trim() || !agentId.value) return false;
  if (isHigh.value) return Boolean(image.value);

  return selectedServices.value.length > 0;
});

function resetForm() {
  const profile = props.profile;

  name.value = "";
  image.value = "";
  level.value = "medium";
  services.value = [];
  agentId.value = store.enrolledAgents[0]?.agent_id ?? "";

  if (!profile) return;

  name.value = profile.name;
  level.value = profile.level;

  const keys: ServiceKey[] = SERVICES.map((service) => service.key);

  for (const service of profile.services) {
    if (!keys.includes(service.key)) keys.push(service.key);
  }

  services.value = keys.map((key) => {
    const preset = profile.services.find((item) => item.key === key);

    return {
      key,
      port: preset?.port ?? serviceMeta(key).defaultPort,
      enabled: Boolean(preset) && store.isServiceAvailable(key, profile.level),
    };
  });
}

watch(
  () => [props.open, props.profile?.id] as const,
  ([isOpen]) => {
    if (isOpen) {
      resetForm();

      if (level.value === "high" && !store.qemuImages.length) {
        void store.loadQemuImages();
      }
    }
  },
  { immediate: true },
);

watch(level, (value) => {
  if (value === "high" && !store.qemuImages.length) {
    void store.loadQemuImages();
  }
});

async function submit() {
  if (!props.profile || !canSubmit.value) return;

  const created = await store.createTraps({
    name: name.value,
    level: level.value,
    agentId: agentId.value,
    services: selectedServices.value.map((service) => ({
      key: service.key,
      port: service.port,
    })),
    image: image.value || undefined,
  });

  const first = created[0];

  if (!first) {
    if (store.error) {
      toast.add({
        title: "Не удалось создать ловушку",
        description: store.error,
        color: "error",
        icon: "i-lucide-triangle-alert",
      });
    }

    return;
  }

  toast.add({
    title:
      created.length > 1
        ? `Создано ловушек: ${created.length}`
        : `Ловушка ${first.name} создана`,
    description: `Профиль: ${props.profile.name}`,
    color: "success",
    icon: "i-lucide-check",
  });

  open.value = false;
  emit("created", first.id);
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

        <UAlert
          v-if="!agentItems.length"
          color="warning"
          variant="soft"
          icon="i-lucide-server-off"
          title="Нет зарегистрированных агентов"
          description="Сначала выполните enroll агента — ловушку можно развернуть только на enrolled-агенте."
        />

        <UFormField label="Название ловушки" required>
          <UInput
            v-model="name"
            placeholder="например, corp-portal-prod"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Уровень эмуляции"
            hint="Насколько детально эмулируется сервис"
          >
            <USelect
              v-model="level"
              :items="levelItems"
              icon="i-lucide-gauge"
              class="w-full"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Агент размещения" required>
            <USelect
              v-model="agentId"
              :items="agentItems"
              :placeholder="agentItems.length ? undefined : 'нет агентов'"
              icon="i-lucide-server"
              class="w-full"
              :disabled="!agentItems.length"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>
        </div>

        <UFormField
          v-if="isHigh"
          label="Образ QEMU"
          required
          hint="High-уровень разворачивается как виртуальная машина"
        >
          <USelect
            v-model="image"
            :items="imageItems"
            :placeholder="
              imageItems.length ? 'выберите образ' : 'образы не загружены'
            "
            icon="i-lucide-disc-3"
            class="w-full"
            :disabled="!imageItems.length"
            :ui="{ leading: 'pointer-events-none' }"
          />
          <p
            v-if="!imageItems.length"
            class="mt-1.5 text-[11px] text-muted"
          >
            Загрузите .qcow2/.img/.raw через API /qemu-images — пока создать
            high-ловушку нельзя.
          </p>
        </UFormField>

        <div v-else class="space-y-2">
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
                :label="serviceMeta(service.key).label"
                :disabled="!serviceAvailable(service.key)"
                @update:model-value="services[index]!.enabled = $event as boolean"
              />

              <UIcon
                :name="serviceMeta(service.key).icon"
                class="size-4 text-dimmed"
              />

              <span
                v-if="!serviceAvailable(service.key)"
                class="text-[11px] text-muted"
              >
                нет в каталоге типов
              </span>

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
          <template v-if="isHigh">
            будет создана <span class="font-mono">qemu-high</span>
          </template>
          <template v-else>
            сервисов: <span class="font-mono">{{ selectedServices.length }}</span>
          </template>
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
            :loading="store.pending"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
