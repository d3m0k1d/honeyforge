<script setup lang="ts">
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const state = reactive({
  login: "",
  password: "",
});

const passwordVisible = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldUi = {
  leading: "pointer-events-none",
  trailing: "pe-1",
};

const passwordType = computed(() => (passwordVisible.value ? "text" : "password"));
const passwordIcon = computed(() =>
  passwordVisible.value ? "i-lucide-eye-off" : "i-lucide-eye",
);
const passwordHint = computed(() =>
  passwordVisible.value ? "Скрыть пароль" : "Показать пароль",
);

function validate(): string | null {
  const login = state.login.trim();

  if (!login) return "Укажите e-mail";
  if (!EMAIL_RE.test(login)) return "Введите корректный e-mail";
  if (!state.password) return "Укажите пароль";

  return null;
}

async function onSubmit() {
  const validationError = validate();

  if (validationError) {
    auth.error = validationError;
    return;
  }

  const success = await auth.login({
    login: state.login,
    password: state.password,
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
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-log-in" class="size-4 text-dimmed" />
          <span class="text-eyebrow">Вход в аккаунт</span>
        </div>

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

          <UFormField label="Пароль" required>
            <UInput
              v-model="state.password"
              name="password"
              :type="passwordType"
              placeholder="••••••••••••"
              autocomplete="current-password"
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
            label="Войти"
            :loading="auth.pending"
            block
          />
        </UForm>

        <p class="text-center text-[11px] text-dimmed">
          Вход через API HoneypotForge · аккаунты создаёт администратор
        </p>
      </UCard>
    </div>
  </div>
</template>
