import { defineStore } from "pinia";
import type { AuthUser, Credentials } from "~/types/auth";
import type { UserRead } from "~/types/api";
import { authApi } from "~/api/auth";
import { clearCache } from "~/api/cache";
import { humanizeAuthError, toApiError } from "~/api/errors";
import { clearToken, getToken, setToken } from "~/api/token";

const SESSION_COOKIE = "honeypotforge:session";

function toAuthUser(apiUser: UserRead): AuthUser {
  const roles = apiUser.roles.map((role) => role.name);
  const permissions = [
    ...new Set(apiUser.roles.flatMap((role) => role.permissions ?? [])),
  ];

  return {
    id: String(apiUser.id),
    numericId: apiUser.id,
    login: apiUser.email,
    roles,
    isAdmin: roles.includes("admin"),
    createdAt: apiUser.created_at,
    firstName: apiUser.first_name,
    lastName: apiUser.last_name,
    permissions,
  };
}

export const useAuthStore = defineStore("auth", () => {
  const session = useCookie<AuthUser | null>(SESSION_COOKIE, {
    default: () => null,
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
    path: "/",
  });

  const user = ref<AuthUser | null>(session.value);
  const pending = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(user.value));

  let restored = false;

  function startSession(stored: AuthUser) {
    user.value = stored;
    session.value = stored;
  }

  function endSession() {
    user.value = null;
    error.value = null;
    session.value = null;
  }

  /** Есть ли у пользователя право (собрано из ролей API). */
  function can(permission: string): boolean {
    return Boolean(user.value?.permissions?.includes(permission));
  }

  /** Есть ли хотя бы одно из указанных прав. */
  function canAny(...permissions: string[]): boolean {
    return permissions.some((permission) => can(permission));
  }

  /**
   * Восстановление сессии при загрузке приложения:
   * токен из localStorage + сверка с GET /auth/me.
   */
  async function init(): Promise<void> {
    if (!import.meta.client || restored) return;
    restored = true;

    if (!user.value && session.value) user.value = session.value;
    if (!user.value) return;

    if (!getToken()) {
      endSession();
      return;
    }

    try {
      const me = await authApi.me({ force: true });
      startSession(toAuthUser(me));
    } catch (err) {
      const apiError = toApiError(err);

      // 401 — токен истёк/отозван; сетевые сбои не должны разлогинивать
      if (apiError.status === 401) endSession();
    }
  }

  async function login(credentials: Credentials): Promise<boolean> {
    pending.value = true;
    error.value = null;

    try {
      const email = credentials.login.trim();
      const password = credentials.password;

      if (!email || !password) {
        error.value = "Укажите e-mail и пароль";
        return false;
      }

      try {
        const tokenResponse = await authApi.login({ email, password });
        setToken(tokenResponse.access_token, tokenResponse.expires_in);

        const me = await authApi.me({ force: true });
        startSession(toAuthUser(me));

        return true;
      } catch (err) {
        error.value = humanizeAuthError(toApiError(err));
        return false;
      }
    } finally {
      pending.value = false;
    }
  }

  function logout() {
    clearToken();
    clearCache();
    endSession();
  }

  function clearError() {
    error.value = null;
  }

  /**
   * Смена собственного пароля. Текущий пароль проверяется повторным
   * запросом к /auth/login, новый записывается через админский
   * PUT /auth/users/{id}/password (нужен permission users:manage).
   */
  async function changePassword(current: string, next: string) {
    const self = user.value;

    if (!self) {
      return { ok: false as const, error: "Сессия не найдена" };
    }

    if (!current || !next) {
      return { ok: false as const, error: "Заполните оба поля" };
    }

    if (next.length < 12) {
      return {
        ok: false as const,
        error: "Новый пароль — минимум 12 символов",
      };
    }

    if (!can("users:manage")) {
      return {
        ok: false as const,
        error: "Смена пароля доступна только администратору",
      };
    }

    if (current === next) {
      return {
        ok: false as const,
        error: "Новый пароль должен отличаться от текущего",
      };
    }

    try {
      await authApi.login({ email: self.login, password: current });
    } catch (err) {
      const apiError = toApiError(err);

      if (apiError.status === 401) {
        return { ok: false as const, error: "Текущий пароль неверен" };
      }
      if (apiError.status === 403) {
        return { ok: false as const, error: "Аккаунт неактивен" };
      }

      return { ok: false as const, error: apiError.message };
    }

    try {
      await authApi.resetUserPassword(self.numericId, { password: next });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: toApiError(err).message };
    }
  }

  return {
    user,
    pending,
    error,
    isAuthenticated,
    can,
    canAny,
    init,
    endSession,
    login,
    logout,
    clearError,
    changePassword,
  };
});
