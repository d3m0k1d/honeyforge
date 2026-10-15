<script setup lang="ts">
import { DASHBOARD_WIDGETS, THEMES } from "~/utils/theme";
import type { NavMode, ThemeId } from "~/utils/theme";

const settings = useSettingsStore();
const auth = useAuthStore();
const toast = useToast();
const colorMode = useColorMode();

const navItems = [
  {
    label: "Радиальное меню",
    value: "radial",
    description: "Навигация вызывается кликом в любую точку экрана",
  },
  {
    label: "Навигация в шапке",
    value: "header",
    description: "Обычные ссылки в верхней панели; клик по фону не открывает меню",
  },
];

const customFields = [
  { key: "accent" as const, label: "Акцент" },
  { key: "lightBg" as const, label: "Светлый фон" },
  { key: "darkBg" as const, label: "Тёмный фон" },
];

function onCustomColor(key: "accent" | "lightBg" | "darkBg", event: Event) {
  const target = event.target as HTMLInputElement;

  settings.setCustom({ [key]: target.value });
}

const currentPassword = ref("");
const newPassword = ref("");
const confirmNew = ref("");
const passwordPending = ref(false);

const passwordFormError = computed(() => {
  if (!newPassword.value && !confirmNew.value) return null;
  if (newPassword.value.length < 12) return "Минимум 12 символов";
  if (newPassword.value !== confirmNew.value) return "Пароли не совпадают";

  return null;
});

const canSelfReset = computed(() => auth.can("users:manage"));

const canChangePassword = computed(
  () =>
    Boolean(
      currentPassword.value && newPassword.value && !passwordFormError.value,
    ),
);

async function onChangePassword() {
  if (!canChangePassword.value) {
    toast.add({
      title: "Проверьте поля",
      description: passwordFormError.value ?? "Укажите текущий и новый пароль",
      color: "error",
      icon: "i-lucide-triangle-alert",
    });
    return;
  }

  passwordPending.value = true;

  const result = await auth.changePassword(
    currentPassword.value,
    newPassword.value,
  );

  passwordPending.value = false;

  if (result.ok) {
    currentPassword.value = "";
    newPassword.value = "";
    confirmNew.value = "";

    toast.add({
      title: "Пароль обновлён",
      description: "Используйте его при следующем входе",
      color: "success",
      icon: "i-lucide-check",
    });
    return;
  }

  toast.add({
    title: "Не удалось сменить пароль",
    description: result.error,
    color: "error",
    icon: "i-lucide-triangle-alert",
  });
}

const notifyOptions = [
  { key: "critical" as const, label: "Критичные события — мгновенно" },
  { key: "warning" as const, label: "Предупреждения" },
  { key: "daily" as const, label: "Ежедневная сводка" },
];

function onReset() {
  settings.reset();

  toast.add({
    title: "Настройки сброшены",
    description: "Возвращены значения по умолчанию",
    color: "success",
    icon: "i-lucide-rotate-ccw",
  });
}

onMounted(() => {
  settings.load();
});
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <div class="border-b border-default pb-3">
      <p class="text-eyebrow">Конфигурация · HoneypotForge</p>
      <h1
        class="mt-1 text-lg font-semibold tracking-tight text-highlighted"
      >
        Настройки
      </h1>
    </div>

    <UCard :ui="{ body: 'space-y-5', header: 'p-4' }">
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon name="i-lucide-palette" class="size-4 text-primary" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-highlighted">Стилизация</h2>
            <p class="text-xs text-muted">
              Тема, режим и тип навигации
            </p>
          </div>
        </div>
      </template>

      <div>
        <p class="text-eyebrow">Тема</p>

        <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            v-for="theme in THEMES"
            :key="theme.id"
            type="button"
            class="cursor-pointer rounded-lg border p-3 text-left transition-colors"
            :class="
              settings.themeId === theme.id
                ? 'border-primary bg-elevated'
                : 'border-default hover:border-accented'
            "
            @click="settings.setTheme(theme.id)"
          >
            <span
              class="block size-8 rounded-full"
              :style="{ background: theme.swatch }"
            />
            <span class="mt-2 block text-xs font-semibold text-highlighted">
              {{ theme.name }}
            </span>
            <span class="block text-[11px] text-muted">
              {{ theme.hint }}
            </span>
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-lg border p-3 text-left transition-colors"
            :class="
              settings.themeId === 'custom'
                ? 'border-primary bg-elevated'
                : 'border-default hover:border-accented'
            "
            @click="settings.setTheme('custom' as ThemeId)"
          >
            <span
              class="block size-8 rounded-full bg-linear-to-br from-primary via-primary/60 to-primary/20"
            />
            <span class="mt-2 block text-xs font-semibold text-highlighted">
              Своя
            </span>
            <span class="block text-[11px] text-muted">
              свои цвета
            </span>
          </button>
        </div>
      </div>

      <div
        v-if="settings.themeId === 'custom'"
        class="space-y-3 rounded-lg border border-default bg-elevated/40 p-3"
      >
        <p class="text-eyebrow">Своя тема</p>

        <div
          v-for="field in customFields"
          :key="field.key"
          class="flex items-center justify-between gap-3"
        >
          <label
            class="text-xs text-toned"
            :for="`custom-${field.key}`"
          >
            {{ field.label }}
          </label>

          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-muted">
              {{ settings.custom[field.key] }}
            </span>
            <input
              :id="`custom-${field.key}`"
              type="color"
              class="h-8 w-12 cursor-pointer rounded-md border border-default bg-elevated p-1"
              :value="settings.custom[field.key]"
              @input="onCustomColor(field.key, $event)"
            />
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <USwitch
          :model-value="colorMode.value === 'dark'"
          label="Тёмный режим"
          @update:model-value="colorMode.preference = $event ? 'dark' : 'light'"
        />
        <p class="text-[11px] text-muted">
          Кнопка в шапке переключает только светлый/тёмный режим выбранной
          темы.
        </p>
      </div>

      <div>
        <p class="text-eyebrow">Навигация</p>

        <URadioGroup
          class="mt-2"
          legend="Тип навигации"
          :items="navItems"
          :model-value="settings.navMode"
          @update:model-value="settings.setNavMode($event as NavMode)"
        />
      </div>

      <div v-if="settings.navMode === 'radial'">
        <div class="flex items-center justify-between">
          <p class="text-eyebrow">Радиус радиального меню</p>
          <span class="font-mono text-xs text-toned">
            {{ settings.radialRadius }} px
          </span>
        </div>

        <USlider
          v-model="settings.radialRadius"
          class="mt-3"
          :min="140"
          :max="260"
          :step="10"
          tooltip
        />
      </div>
    </UCard>

    <UCard :ui="{ body: 'space-y-4', header: 'p-4' }">
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon
              name="i-lucide-layout-dashboard"
              class="size-4 text-primary"
            />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-highlighted">
              Главный экран
            </h2>
            <p class="text-xs text-muted">
              Виджеты дашборда для авторизованных пользователей
            </p>
          </div>
        </div>
      </template>

      <div class="grid gap-3 sm:grid-cols-2">
        <UCheckbox
          v-for="widget in DASHBOARD_WIDGETS"
          :key="widget.key"
          :label="widget.label"
          :description="widget.description"
          :model-value="settings.dashboard.includes(widget.key)"
          @update:model-value="settings.toggleWidget(widget.key)"
        />
      </div>

      <p v-if="!settings.dashboard.length" class="text-xs text-muted">
        Ни один виджет не выбран — дашборд будет пустым.
      </p>
    </UCard>

    <UCard :ui="{ body: 'space-y-4', header: 'p-4' }">
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon name="i-lucide-bot" class="size-4 text-primary" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-highlighted">
              Уведомления
            </h2>
            <p class="text-xs text-muted">
              Telegram-бот @honeypotforge_bot
            </p>
          </div>
        </div>
      </template>

      <USwitch
        v-model="settings.notify.enabled"
        label="Присылать уведомления об инцидентах"
      />

      <UInput
        v-model="settings.notify.chat"
        :disabled="!settings.notify.enabled"
        icon="i-lucide-send"
        placeholder="Чат или канал: @honeypot / -1001234567"
        class="w-full"
        :ui="{ leading: 'pointer-events-none' }"
      />

      <div
        class="space-y-3"
        :class="
          settings.notify.enabled ? '' : 'pointer-events-none opacity-50'
        "
      >
        <UCheckbox
          v-for="option in notifyOptions"
          :key="option.key"
          v-model="settings.notify[option.key]"
          :label="option.label"
        />
      </div>
    </UCard>

    <UCard :ui="{ body: 'space-y-4', header: 'p-4' }">
      <template #header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-9 items-center justify-center rounded-md border border-default bg-elevated"
          >
            <UIcon name="i-lucide-shield-check" class="size-4 text-primary" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-highlighted">Безопасность</h2>
            <p class="text-xs text-muted">Смена пароля текущего пользователя</p>
          </div>
        </div>
      </template>

      <UInput
        :model-value="auth.user?.login ?? '—'"
        icon="i-lucide-user-round"
        class="w-full"
        disabled
        :ui="{ leading: 'pointer-events-none' }"
      />

      <UAlert
        v-if="!canSelfReset"
        color="info"
        variant="soft"
        icon="i-lucide-info"
        title="Смена пароля доступна администратору"
        description="Обратитесь к администратору — он сбросит пароль в админ-панели."
      />

      <template v-else>
        <UInput
          v-model="currentPassword"
          type="password"
          icon="i-lucide-key-round"
          placeholder="Текущий пароль"
          class="w-full"
          autocomplete="current-password"
          :ui="{ leading: 'pointer-events-none' }"
        />

        <UInput
          v-model="newPassword"
          type="password"
          icon="i-lucide-key-round"
          placeholder="Новый пароль — минимум 12 символов"
          class="w-full"
          autocomplete="new-password"
          :ui="{ leading: 'pointer-events-none' }"
        />

        <UInput
          v-model="confirmNew"
          type="password"
          icon="i-lucide-key-round"
          placeholder="Повторите новый пароль"
          class="w-full"
          autocomplete="new-password"
          :ui="{ leading: 'pointer-events-none' }"
        />

        <p v-if="passwordFormError" class="text-xs text-error">
          {{ passwordFormError }}
        </p>

        <div class="flex justify-end">
          <UButton
            class="cursor-pointer"
            icon="i-lucide-shield-check"
            label="Сменить пароль"
            :loading="passwordPending"
            :disabled="!canChangePassword"
            @click="onChangePassword"
          />
        </div>
      </template>
    </UCard>

    <UCard :ui="{ body: 'flex flex-wrap items-center justify-between gap-3' }">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-highlighted">
          Сброс локальных настроек
        </p>
        <p class="mt-0.5 max-w-lg text-xs text-muted">
          Тема, навигация, виджеты и уведомления вернутся к значениям по
          умолчанию. Ловушки и аккаунты не затрагиваются.
        </p>
      </div>

      <UButton
        class="cursor-pointer"
        color="error"
        variant="soft"
        icon="i-lucide-rotate-ccw"
        label="Сбросить"
        @click="onReset"
      />
    </UCard>
  </div>
</template>
