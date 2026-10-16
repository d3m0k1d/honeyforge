import { defineStore } from "pinia";
import type {
  RoleName,
  UserCreate,
  UserProfileUpdate,
  UserRead,
} from "~/types/api";
import { authApi } from "~/api/auth";
import { humanizeAuthError, toApiError } from "~/api/errors";

export interface NewUserInput extends UserCreate {
  roles: RoleName[];
}

export const useUsersStore = defineStore("users", () => {
  const list = ref<UserRead[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pending = ref(false);

  let loaded = false;

  async function fetch(force = false): Promise<void> {
    if (loading.value || (!force && loaded)) return;

    loading.value = true;
    error.value = null;

    try {
      list.value = await authApi.users({ force });
      loaded = true;
    } catch (err) {
      error.value = humanizeAuthError(toApiError(err));
    } finally {
      loading.value = false;
    }
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    pending.value = true;
    error.value = null;

    try {
      return await action();
    } catch (err) {
      error.value = humanizeAuthError(toApiError(err));
      return null;
    } finally {
      pending.value = false;
    }
  }

  /** Локально подменить пользователя в списке (после успешной мутации). */
  function upsert(user: UserRead) {
    const index = list.value.findIndex((item) => item.id === user.id);

    if (index === -1) {
      list.value = [...list.value, user];
      return;
    }

    const next = [...list.value];
    next[index] = user;
    list.value = next;
  }

  /** Создание пользователя (users:manage) + назначение ролей (roles:manage). */
  async function create(input: NewUserInput): Promise<UserRead | null> {
    const { roles, ...payload } = input;

    const created = await run(() => authApi.createUser(payload));
    if (!created) return null;

    if (roles.length) {
      const withRoles = await run(() => authApi.updateUserRoles(created.id, roles));
      if (withRoles) {
        upsert(withRoles);
        return withRoles;
      }
    }

    upsert(created);
    return created;
  }

  async function updateProfile(userId: number, payload: UserProfileUpdate) {
    const updated = await run(() => authApi.updateUserProfile(userId, payload));
    if (updated) upsert(updated);

    return updated;
  }

  /** 204 без тела: успех = не null. */
  async function resetPassword(userId: number, password: string) {
    const result = await run(() => authApi.resetUserPassword(userId, { password }));

    return result !== null;
  }

  async function setStatus(userId: number, isActive: boolean) {
    const updated = await run(() =>
      authApi.updateUserStatus(userId, { is_active: isActive }),
    );
    if (updated) upsert(updated);

    return updated;
  }

  /** Мягкая деактивация (DELETE /auth/users/{id}). */
  async function deactivate(userId: number) {
    const result = await run(() => authApi.deactivateUser(userId));
    const ok = result !== null;

    if (ok) {
      const current = list.value.find((item) => item.id === userId);
      if (current) upsert({ ...current, is_active: false });
    }

    return ok;
  }

  async function assignRoles(userId: number, roles: RoleName[]) {
    const updated = await run(() => authApi.updateUserRoles(userId, roles));
    if (updated) upsert(updated);

    return updated;
  }

  return {
    list,
    loading,
    pending,
    error,
    fetch,
    create,
    updateProfile,
    resetPassword,
    setStatus,
    deactivate,
    assignRoles,
  };
});
