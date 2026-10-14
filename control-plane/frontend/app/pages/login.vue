<script setup lang="ts">
import type { AuthMode } from "~/types/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const mode = ref<AuthMode>(
  route.query.mode === "register" ? "register" : "login",
);

const state = reactive({
  login: "",
  password: "",
});

const passwordVisible = ref(false);

const tabs = [
  { label: "Вход", value: "login", icon: "i-lucide-log-in" },
  { label: "Регистрация", value: "register", icon: "i-lucide-user-plus" },
];

const tabsUi = {
  list: "w-full bg-muted/40 border border-default rounded-lg p-0.5",
  trigger: "flex-1 justify-center gap-1.5 text-xs uppercase tracking-[0.14em]",
};

const fieldUi = {
  leading: "pointer-events-none",
  trailing: "pe-1",
};

const submitLabel = computed(() =>
  mode.value === "login" ? "Войти" : "Создать аккаунт",
);

const passwordType = computed(() => (passwordVisible.value ? "text" : "password"));
const passwordAutocomplete = computed(() =>
  mode.value === "login" ? "current-password" : "new-password",
);
const passwordIcon = computed(() =>
  passwordVisible.value ? "i-lucide-eye-off" : "i-lucide-eye",
);
const passwordHint = computed(() =>
  passwordVisible.value ? "Скрыть пароль" : "Показать пароль",
);

watch(mode, () => auth.clearError());

async function onSubmit() {
  const credentials = { login: state.login, password: state.password };
  const success =
    mode.value === "login"
      ? await auth.login(credentials)
      : await auth.register(credentials);

  if (!success) return;

  const redirect =
    typeof route.query.redirect === "string" ? route.query.redirect : "/";

  await router.push(redirect);
}
</script>

<template>
  <div class="flex min-h-[60vh] items-center justify-center py-6">
    <div class="w-full max-w-sm">
      <div class="flex flex-col items-center gap-3 text-center">
        <AppLogo />
        <p class="text-eyebrow">Панель управления honeypot-инцидентами</p>
      </div>

      <UCard class="mt-6" :ui="{ body: 'space-y-4' }">
        <UTabs
          v-model="mode"
          :items="tabs"
          :unmount-on-hide="false"
          :content="false"
          :ui="tabsUi"
        />

        <UAlert
          v-if="auth.error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="auth.error"
        />

        <UForm :state="state" class="space-y-4" @submit="onSubmit">
          <UFormField label="Логин" required>
            <UInput
              v-model="state.login"
              name="login"
              placeholder="analyst"
              autocomplete="username"
              :disabled="auth.pending"
              :ui="fieldUi"
              class="w-full"
              icon="i-lucide-user-round"
            />
          </UFormField>

          <UFormField label="Пароль" required>
            <UInput
              v-model="state.password"
              name="password"
              :type="passwordType"
              placeholder="••••••••"
              :autocomplete="passwordAutocomplete"
              :disabled="auth.pending"
              :ui="fieldUi"
              class="w-full"
              icon="i-lucide-key-round"
            >
              <template #trailing>
                <UButton
                  class="cursor-pointer"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :icon="passwordIcon"
                  :aria-label="passwordHint"
                  @click="passwordVisible = !passwordVisible"
                />
              </template>
            </UInput>
          </UFormField>

          <UButton
            type="submit"
            class="cursor-pointer justify-center"
            :label="submitLabel"
            :loading="auth.pending"
            block
          />
        </UForm>

        <p class="text-center text-[11px] text-dimmed">
          Демо-режим: аккаунты хранятся локально в браузере
        </p>
      </UCard>
    </div>
  </div>
</template>
