<script setup lang="ts">
import type { TrapProfile } from "~/types/traps";

const props = defineProps<{
  open: boolean;
  profile: TrapProfile | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", trapId: string): void;
}>();

const store = useTrapsStore();
const agents = useAgentsStore();
const toast = useToast();

const open = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const name = ref("");
const agentId = ref("");
const config = ref("{}");
const formError = ref<string | null>(null);
const agentItems = computed(() => agents.agents.map((agent) => ({
  label: `${agent.agent_id} · ${agent.online ? 'Online' : 'Offline'}`,
  value: agent.agent_id,
})));

const canSubmit = computed(
  () => store.canManage && !store.actionPending && Boolean(name.value.trim())
    && agents.agents.some((agent) => agent.agent_id === agentId.value),
);

function resetForm() {
  const profile = props.profile;

  if (!profile) {
    name.value = "";
    return;
  }

  name.value = profile.id;
  agentId.value = agents.agents[0]?.agent_id ?? "";
  config.value = "{}";
  formError.value = null;
  store.actionError = null;
}

watch(
  () => [props.open, props.profile?.id] as const,
  ([isOpen]) => {
    if (isOpen) resetForm();
  },
  { immediate: true },
);

async function submit() {
  if (!props.profile || !canSubmit.value) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(config.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
  } catch {
    formError.value = "Конфигурация должна быть JSON-объектом";
    return;
  }
  formError.value = null;
  const created = await store.createTrap({
    honeypot_type: props.profile.id,
    name: name.value.trim(),
    agent_id: agentId.value,
    config: parsed,
  });
  if (!created) return;

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
    description="Выберите агент и задайте конфигурацию типа ловушки"
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

        <UFormField label="Агент размещения" required>
          <USelect
            v-model="agentId"
            :items="agentItems"
            icon="i-lucide-server"
            class="w-full"
            :ui="{ leading: 'pointer-events-none' }"
          />
        </UFormField>
        <UAlert v-if="agents.error" color="error" :description="agents.error" />
        <UButton v-if="agents.error" label="Повторить загрузку агентов" variant="outline" :loading="agents.pending" @click="agents.load()" />
        <p v-else-if="!agents.agents.length" class="text-xs text-muted">Нет доступных агентов</p>
        <UFormField label="Конфигурация (JSON)" required>
          <UTextarea v-model="config" :rows="8" class="w-full font-mono" />
        </UFormField>
        <details v-if="profile.configSchema" class="text-xs text-muted">
          <summary class="cursor-pointer">Схема конфигурации API</summary>
          <pre class="mt-2 overflow-x-auto">{{ JSON.stringify(profile.configSchema, null, 2) }}</pre>
        </details>
        <UAlert v-if="formError || store.actionError" color="error" :description="formError || store.actionError || ''" />
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
            :loading="store.actionPending === 'create'"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
