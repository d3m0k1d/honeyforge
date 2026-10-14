<script setup lang="ts">
const auth = useAuthStore();
const admin = useAdminStore();
const toast = useToast();

const modalOpen = ref(false);

const form = reactive({
  login: "",
  password: "",
  roles: [] as string[],
});

const canSubmit = computed(
  () => Boolean(form.login.trim()) && Boolean(form.password),
);

function isMockUser(id: string) {
  return id.startsWith("user_mock_");
}

function toggleRole(id: string, value: boolean) {
  form.roles = value
    ? [...form.roles, id]
    : form.roles.filter((role) => role !== id);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU");
}

watch(modalOpen, (open) => {
  if (!open) return;

  form.login = "";
  form.password = "";
  form.roles = [];
  auth.clearError();
});

async function submit() {
  const created = await auth.createUser({
    login: form.login,
    password: form.password,
    roles: form.roles,
  });

  if (!created) {
    toast.add({
      title: "Не удалось создать пользователя",
      description: auth.error ?? undefined,
      color: "error",
      icon: "i-lucide-triangle-alert",
    });
    return;
  }

  toast.add({
    title: `Пользователь ${created.login} создан`,
    description: `Роли: ${created.roles.length ? created.roles.join(", ") : "не назначены"}`,
    color: "success",
    icon: "i-lucide-check",
  });

  modalOpen.value = false;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-users-round" class="size-4 text-dimmed" />
        <span class="text-eyebrow">
          Учётные записи
        </span>
        <UBadge color="neutral" variant="outline" size="sm">
          {{ auth.users.length }}
        </UBadge>
      </div>
      <UButton
        class="cursor-pointer"
        icon="i-lucide-plus"
        label="Создать пользователя"
        size="sm"
        @click="modalOpen = true"
      />
    </div>

    <div class="divide-y divide-default rounded-lg border border-default">
      <div
        v-for="user in auth.users"
        :key="user.id"
        class="flex flex-wrap items-center gap-3 px-4 py-2.5"
      >
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-md border border-default bg-elevated"
        >
          <UIcon name="i-lucide-user-round" class="size-4 text-muted" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate text-sm font-medium text-highlighted">
              {{ user.login }}
            </span>
            <UBadge
              v-if="user.isAdmin"
              color="primary"
              variant="subtle"
              size="sm"
              label="admin"
            />
            <UBadge
              v-if="isMockUser(user.id)"
              color="neutral"
              variant="outline"
              size="sm"
              label="mock"
            />
          </div>
          <p class="font-mono text-[10px] text-dimmed">
            {{ user.id }} · {{ formatDate(user.createdAt) }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge
            v-for="role in user.roles"
            :key="role"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="admin.roleName(role)"
          />
          <span v-if="!user.roles.length" class="text-xs text-dimmed">
            без роли
          </span>
        </div>

        <UButton
          v-if="!isMockUser(user.id)"
          class="cursor-pointer"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          aria-label="Удалить пользователя"
          @click="auth.deleteUser(user.id)"
        />
      </div>
    </div>

    <UModal
      v-model:open="modalOpen"
      title="Новый пользователь"
      description="Логин, пароль и набор ролей"
      :ui="{ content: 'max-w-lg' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Логин" required>
            <UInput
              v-model="form.login"
              placeholder="operator"
              class="w-full"
              icon="i-lucide-user-round"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Пароль" required>
            <UInput
              v-model="form.password"
              type="password"
              placeholder="••••••••"
              class="w-full"
              icon="i-lucide-key-round"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Роли">
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <UCheckbox
                v-for="role in admin.roles"
                :key="role.id"
                :model-value="form.roles.includes(role.id)"
                :label="role.name"
                @update:model-value="toggleRole(role.id, $event)"
              />
            </div>
          </UFormField>

          <UAlert
            v-if="auth.error"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="auth.error"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            label="Отмена"
            @click="modalOpen = false"
          />
          <UButton
            class="cursor-pointer"
            icon="i-lucide-check"
            label="Создать"
            :disabled="!canSubmit"
            :loading="auth.pending"
            @click="submit"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
