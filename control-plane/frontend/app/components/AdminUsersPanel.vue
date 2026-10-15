<script setup lang="ts">
import type { RoleName, UserRead } from "~/types/api";
import { roleLabel } from "~/utils/admin";

const auth = useAuthStore();
const usersStore = useUsersStore();
const admin = useAdminStore();
const toast = useToast();

const modal = ref<"create" | "edit" | "roles" | "password" | null>(null);
const target = ref<UserRead | null>(null);

const createForm = reactive({
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  roles: [] as RoleName[],
});

const editForm = reactive({ email: "", firstName: "", lastName: "" });

const passwordForm = reactive({ password: "", confirm: "" });

const rolesForm = ref<RoleName[]>([]);

const canManageUsers = computed(() => auth.can("users:manage"));
const canManageRoles = computed(() => auth.can("roles:manage"));

const canCreate = computed(
  () =>
    Boolean(
      createForm.email.trim() &&
        createForm.firstName.trim() &&
        createForm.lastName.trim() &&
        createForm.password,
    ) && createForm.password.length >= 12,
);

const passwordError = computed(() => {
  if (!passwordForm.password && !passwordForm.confirm) return null;
  if (passwordForm.password.length < 12) return "Минимум 12 символов";
  if (passwordForm.password !== passwordForm.confirm) return "Пароли не совпадают";

  return null;
});

const modalTitle = computed(() => {
  if (modal.value === "create") return "Новый пользователь";
  if (modal.value === "edit") return "Профиль пользователя";
  if (modal.value === "password") return "Сброс пароля";
  if (modal.value === "roles") return "Роли пользователя";

  return "";
});

const modalDescription = computed(() => {
  if (modal.value === "create")
    return "E-mail, имя, пароль (мин. 12 символов) и набор ролей";
  if (modal.value === "edit") return "E-mail и имя пользователя";
  if (modal.value === "password") return target.value?.email ?? "";
  if (modal.value === "roles")
    return `Права ролей фиксированы на сервере — ${target.value?.email ?? ""}`;

  return "";
});

function closeModal() {
  if (usersStore.pending) return;
  modal.value = null;
}

function isSelf(user: UserRead) {
  return auth.user?.numericId === user.id;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU");
}

function openModal(kind: typeof modal.value, user: UserRead | null = null) {
  target.value = user;
  usersStore.error = null;

  if (kind === "create") {
    createForm.email = "";
    createForm.firstName = "";
    createForm.lastName = "";
    createForm.password = "";
    createForm.roles = [];
  }

  if (kind === "edit" && user) {
    editForm.email = user.email;
    editForm.firstName = user.first_name;
    editForm.lastName = user.last_name;
  }

  if (kind === "password") {
    passwordForm.password = "";
    passwordForm.confirm = "";
  }

  if (kind === "roles" && user) {
    rolesForm.value = user.roles.map((role) => role.name);
  }

  modal.value = kind;
}

function toggleRole(role: RoleName, checked: boolean) {
  rolesForm.value = checked
    ? [...rolesForm.value, role]
    : rolesForm.value.filter((item) => item !== role);
}

function toastResult(
  ok: boolean,
  title: string,
  successDescription?: string,
) {
  if (ok) {
    toast.add({
      title,
      description: successDescription,
      color: "success",
      icon: "i-lucide-check",
    });
    return;
  }

  toast.add({
    title: "Не выполнено",
    description: usersStore.error ?? undefined,
    color: "error",
    icon: "i-lucide-triangle-alert",
  });
}

async function submitCreate() {
  const created = await usersStore.create({
    email: createForm.email.trim(),
    first_name: createForm.firstName.trim(),
    last_name: createForm.lastName.trim(),
    password: createForm.password,
    roles: createForm.roles,
  });

  toastResult(
    Boolean(created),
    `Пользователь ${created?.email ?? ""} создан`,
    created?.roles.length
      ? `Роли: ${created.roles.map((role) => role.name).join(", ")}`
      : "Роли не назначены",
  );

  if (created) modal.value = null;
}

async function submitEdit() {
  if (!target.value) return;

  const updated = await usersStore.updateProfile(target.value.id, {
    email: editForm.email.trim(),
    first_name: editForm.firstName.trim(),
    last_name: editForm.lastName.trim(),
  });

  toastResult(Boolean(updated), `Профиль ${updated?.email ?? ""} обновлён`);
  if (updated) modal.value = null;
}

async function submitPassword() {
  if (!target.value || passwordError.value) return;

  const ok = await usersStore.resetPassword(
    target.value.id,
    passwordForm.password,
  );

  toastResult(Boolean(ok), `Пароль ${target.value.email} обновлён`);
  if (ok) modal.value = null;
}

async function submitRoles() {
  if (!target.value) return;

  const updated = await usersStore.assignRoles(target.value.id, rolesForm.value);

  toastResult(
    Boolean(updated),
    `Роли ${updated?.email ?? ""} обновлены`,
    updated?.roles.length
      ? `Роли: ${updated.roles.map((role) => role.name).join(", ")}`
      : "Роли сняты",
  );
  if (updated) modal.value = null;
}

async function toggleStatus(user: UserRead) {
  const updated = await usersStore.setStatus(user.id, !user.is_active);

  toastResult(
    Boolean(updated),
    updated?.is_active
      ? `${updated.email} активирован`
      : `${updated?.email ?? ""} отключён`,
  );
}

async function deactivate(user: UserRead) {
  const ok = await usersStore.deactivate(user.id);
  toastResult(Boolean(ok), `${user.email} отключён`);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-users-round" class="size-4 text-dimmed" />
        <span class="text-eyebrow">Учётные записи</span>
        <UBadge color="neutral" variant="outline" size="sm">
          {{ usersStore.list.length }}
        </UBadge>
      </div>
      <UButton
        v-if="canManageUsers"
        class="cursor-pointer"
        icon="i-lucide-plus"
        label="Создать пользователя"
        size="sm"
        @click="openModal('create')"
      />
    </div>

    <UAlert
      v-if="usersStore.error && !modal"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="usersStore.error"
    />

    <div
      v-if="usersStore.loading && !usersStore.list.length"
      class="flex items-center justify-center gap-2 rounded-lg border border-default py-8"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-dimmed" />
      <span class="text-xs text-muted">Загрузка пользователей…</span>
    </div>

    <div
      v-else
      class="divide-y divide-default rounded-lg border border-default"
    >
      <div
        v-for="user in usersStore.list"
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
              {{ user.email }}
            </span>
            <UBadge
              v-if="user.roles.some((role) => role.name === 'admin')"
              color="primary"
              variant="subtle"
              size="sm"
              label="admin"
            />
            <UBadge
              :color="user.is_active ? 'success' : 'error'"
              variant="subtle"
              size="sm"
              :label="user.is_active ? 'активен' : 'отключён'"
            />
            <UBadge
              v-if="isSelf(user)"
              color="neutral"
              variant="outline"
              size="sm"
              label="вы"
            />
          </div>
          <p class="truncate text-xs text-muted">
            {{ user.first_name }} {{ user.last_name }}
            <span class="font-mono text-[10px] text-dimmed">
              · id {{ user.id }} · {{ formatDate(user.created_at) }}
            </span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge
            v-for="role in user.roles"
            :key="role.name"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="roleLabel(role.name)"
          />
          <span v-if="!user.roles.length" class="text-xs text-dimmed">
            без роли
          </span>
        </div>

        <div class="flex items-center gap-0.5">
          <UButton
            v-if="canManageRoles"
            class="cursor-pointer"
            icon="i-lucide-shield-check"
            variant="ghost"
            size="xs"
            aria-label="Управление ролями"
            @click="openModal('roles', user)"
          />
          <UButton
            v-if="canManageUsers"
            class="cursor-pointer"
            icon="i-lucide-key-round"
            variant="ghost"
            size="xs"
            aria-label="Сбросить пароль"
            @click="openModal('password', user)"
          />
          <UButton
            v-if="canManageUsers"
            class="cursor-pointer"
            icon="i-lucide-pencil"
            variant="ghost"
            size="xs"
            aria-label="Редактировать профиль"
            @click="openModal('edit', user)"
          />
          <UButton
            v-if="canManageUsers"
            class="cursor-pointer"
            :icon="user.is_active ? 'i-lucide-user-x' : 'i-lucide-user-check'"
            :color="user.is_active ? 'error' : 'success'"
            variant="ghost"
            size="xs"
            :disabled="isSelf(user)"
            :aria-label="user.is_active ? 'Отключить' : 'Активировать'"
            @click="toggleStatus(user)"
          />
          <UButton
            v-if="canManageUsers"
            class="cursor-pointer"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :disabled="isSelf(user)"
            aria-label="Отключить пользователя"
            @click="deactivate(user)"
          />
        </div>
      </div>

      <div
        v-if="!usersStore.list.length && !usersStore.loading"
        class="px-4 py-6 text-center text-xs text-dimmed"
      >
        Пользователи не найдены
      </div>
    </div>

    <UModal
      :open="modal !== null"
      :title="modalTitle"
      :description="modalDescription"
      :dismissible="!usersStore.pending"
      :ui="{ content: 'max-w-lg' }"
      @update:open="closeModal"
    >
      <template #body>
        <div v-if="modal === 'create'" class="space-y-4">
          <UFormField label="E-mail" required>
            <UInput
              v-model="createForm.email"
              name="newEmail"
              type="email"
              placeholder="analyst@example.com"
              class="w-full"
              icon="i-lucide-mail"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Имя" required>
              <UInput
                v-model="createForm.firstName"
                name="newFirstName"
                placeholder="Аналитик"
                class="w-full"
                icon="i-lucide-user-round"
                :ui="{ leading: 'pointer-events-none' }"
              />
            </UFormField>
            <UFormField label="Фамилия" required>
              <UInput
                v-model="createForm.lastName"
                name="newLastName"
                placeholder="Иванов"
                class="w-full"
                icon="i-lucide-user-round"
                :ui="{ leading: 'pointer-events-none' }"
              />
            </UFormField>
          </div>

          <UFormField label="Пароль" hint="Минимум 12 символов" required>
            <UInput
              v-model="createForm.password"
              name="newPassword"
              type="password"
              placeholder="••••••••••••"
              autocomplete="new-password"
              class="w-full"
              icon="i-lucide-key-round"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Роли">
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <UCheckbox
                v-for="role in admin.roles"
                :key="role.name"
                :model-value="createForm.roles.includes(role.name)"
                :label="roleLabel(role.name)"
                @update:model-value="toggleRole(role.name, Boolean($event))"
              />
              <span v-if="!admin.roles.length" class="text-xs text-dimmed">
                Роли не загружены
              </span>
            </div>
          </UFormField>
        </div>

        <div v-else-if="modal === 'edit' && target" class="space-y-4">
          <UFormField label="E-mail" required>
            <UInput
              v-model="editForm.email"
              type="email"
              class="w-full"
              icon="i-lucide-mail"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Имя" required>
              <UInput v-model="editForm.firstName" class="w-full" />
            </UFormField>
            <UFormField label="Фамилия" required>
              <UInput v-model="editForm.lastName" class="w-full" />
            </UFormField>
          </div>
        </div>

        <div v-else-if="modal === 'password' && target" class="space-y-4">
          <UFormField label="Новый пароль" hint="Минимум 12 символов" required>
            <UInput
              v-model="passwordForm.password"
              name="resetPassword"
              type="password"
              autocomplete="new-password"
              class="w-full"
              icon="i-lucide-key-round"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Повторите пароль" required>
            <UInput
              v-model="passwordForm.confirm"
              name="resetPasswordConfirm"
              type="password"
              autocomplete="new-password"
              class="w-full"
              icon="i-lucide-key-round"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <p v-if="passwordError" class="text-xs text-error">
            {{ passwordError }}
          </p>
        </div>

        <div v-else-if="modal === 'roles' && target" class="space-y-3">
          <div
            v-for="role in admin.roles"
            :key="role.name"
            class="rounded-lg border border-default bg-elevated/40 p-3"
          >
            <UCheckbox
              :model-value="rolesForm.includes(role.name)"
              :label="roleLabel(role.name)"
              @update:model-value="toggleRole(role.name, Boolean($event))"
            />
            <div class="mt-2 flex flex-wrap gap-1.5 pl-6">
              <UBadge
                v-for="permission in role.permissions"
                :key="permission"
                color="neutral"
                variant="outline"
                size="sm"
                :label="permission"
              />
            </div>
          </div>
        </div>

        <UAlert
          v-if="usersStore.error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="usersStore.error"
        />
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Отмена"
            :disabled="usersStore.pending"
            @click="closeModal"
          />
          <UButton
            v-if="modal === 'create'"
            icon="i-lucide-check"
            label="Создать"
            :disabled="!canCreate"
            :loading="usersStore.pending"
            @click="submitCreate"
          />
          <UButton
            v-else-if="modal === 'edit'"
            icon="i-lucide-check"
            label="Сохранить"
            :disabled="
              !editForm.email.trim() ||
              !editForm.firstName.trim() ||
              !editForm.lastName.trim()
            "
            :loading="usersStore.pending"
            @click="submitEdit"
          />
          <UButton
            v-else-if="modal === 'password'"
            icon="i-lucide-key-round"
            label="Сбросить"
            :disabled="Boolean(passwordError) || !passwordForm.password"
            :loading="usersStore.pending"
            @click="submitPassword"
          />
          <UButton
            v-else-if="modal === 'roles'"
            icon="i-lucide-check"
            label="Сохранить"
            :loading="usersStore.pending"
            @click="submitRoles"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
