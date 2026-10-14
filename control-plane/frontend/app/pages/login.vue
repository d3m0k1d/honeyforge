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
  firstName: "",
  lastName: "",
});

const passwordVisible = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

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

const passwordLengthHint = computed(() =>
  mode.value === "register"
    ? `Минимум ${MIN_PASSWORD_LENGTH} символов`
    : null,
);

function validate(): string | null {
  const login = state.login.trim();

  if (!login) return "Укажите e-mail";
  if (!state.password) return "Укажите пароль";

  if (mode.value === "register") {
    if (!EMAIL_RE.test(login)) return "Введите корректный e-mail";
    if (state.password.length < MIN_PASSWORD_LENGTH)
      return `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`;
    if (state.password.length > 128) return "Пароль слишком длинный";
    if (!state.firstName.trim() || !state.lastName.trim())
      return "Укажите имя и фамилию";
  }

  return null;
}

watch(mode, () => auth.clearError());

async function onSubmit() {
  const validationError = validate();

  if (validationError) {
    auth.error = validationError;
    return;
  }

  const success =
    mode.value === "login"
      ? await auth.login({ login: state.login, password: state.password })
      : await auth.register({
          login: state.login,
          password: state.password,
          firstName: state.firstName,
          lastName: state.lastName,
        });

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
          <UFormField label="E-mail" required>
            <UInput
              v-model="state.login"
              name="login"
              type="email"
              placeholder="analyst@example.com"
              autocomplete="username"
              :disabled="auth.pending"
              :ui="fieldUi"
              class="w-full"
              icon="i-lucide-mail"
            />
          </UFormField>

          <template v-if="mode === 'register'">
            <UFormField label="Имя" required>
              <UInput
                v-model="state.firstName"
                name="firstName"
                placeholder="Аналитик"
                autocomplete="given-name"
                :disabled="auth.pending"
                :ui="fieldUi"
                class="w-full"
                icon="i-lucide-user-round"
              />
            </UFormField>

            <UFormField label="Фамилия" required>
              <UInput
                v-model="state.lastName"
                name="lastName"
                placeholder="Иванов"
                autocomplete="family-name"
                :disabled="auth.pending"
                :ui="fieldUi"
                class="w-full"
                icon="i-lucide-user-round"
              />
            </UFormField>
          </template>

          <UFormField
            label="Пароль"
            :hint="passwordLengthHint ?? undefined"
            required
          >
            <UInput
              v-model="state.password"
              name="password"
              :type="passwordType"
              placeholder="••••••••••••"
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
          Вход через API HoneypotForge · локальные демо-аккаунты — как fallback
        </p>
      </UCard>
    </div>
  </div>
</template>
