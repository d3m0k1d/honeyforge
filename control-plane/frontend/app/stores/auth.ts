import { defineStore } from "pinia";
import type {
  AuthUser,
  Credentials,
  NewUser,
  RegisterPayload,
  StoredUser,
} from "~/types/auth";
import type { UserRead } from "~/types/api";
import { authApi } from "~/api/auth";
import { clearCache } from "~/api/cache";
import { toApiError, type ApiError } from "~/api/errors";
import { clearToken, getToken, setToken } from "~/api/token";
import mockUsers from "~/data/users.json";

const USERS_KEY = "honeypotforge:custom-users";
const SESSION_COOKIE = "honeypotforge:session";
const PASSWORD_OVERRIDES_KEY = "honeypotforge:password-overrides";

const MOCK_USERS = mockUsers as unknown as StoredUser[];
const MOCK_IDS = new Set(MOCK_USERS.map((user) => user.id));

function createId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${prefix}_${random}`;
}

function findUser(login: string) {
  const query = login.trim().toLowerCase();

  return MOCK_USERS.find((user) => user.login.toLowerCase() === query);
}

function readPasswordOverrides(): Record<string, string> {
  if (!import.meta.client) return {};

  try {
    const raw = localStorage.getItem(PASSWORD_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePasswordOverrides(map: Record<string, string>) {
  if (!import.meta.client) return;

  localStorage.setItem(PASSWORD_OVERRIDES_KEY, JSON.stringify(map));
}

function effectivePassword(stored: StoredUser) {
  return readPasswordOverrides()[stored.id] ?? stored.password;
}

/** Перевод типичных ошибок HoneypotForge API на человекочитаемый русский. */
function humanizeError(error: ApiError): string {
  if (error.status === 401) return "Неверный e-mail или пароль";
  if (error.status === 403)
    return "Доступ запрещён: аккаунт неактивен или не хватает прав";
  if (error.status === 409) return "Пользователь с таким e-mail уже существует";

  if (error.status === 422) {
    if (/at least 12/i.test(error.message))
      return "Пароль должен содержать минимум 12 символов";
    if (/not a valid email/i.test(error.message)) return "Некорректный e-mail";

    return "Проверьте корректность заполненных полей";
  }

  return error.message;
}

function toAuthUser(apiUser: UserRead): AuthUser {
  const roles = apiUser.roles.map((role) => role.name);
  const permissions = [
    ...new Set(apiUser.roles.flatMap((role) => role.permissions ?? [])),
  ];

  return {
    id: String(apiUser.id),
    login: apiUser.email,
    roles,
    isAdmin: roles.includes("admin"),
    createdAt: apiUser.created_at,
    source: "api",
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

  const customUsers = ref<StoredUser[]>([]);

  const users = computed(() => [...customUsers.value, ...MOCK_USERS]);
  const isAuthenticated = computed(() => Boolean(user.value));

  let restored = false;

  function readCustomUsers(): StoredUser[] {
    if (!import.meta.client) return [];

    try {
      const raw = localStorage.getItem(USERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];

      return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
    } catch {
      return [];
    }
  }

  function writeCustomUsers(list: StoredUser[]) {
    if (!import.meta.client) return;

    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }

  function loadUsers() {
    customUsers.value = readCustomUsers();
  }

  function startSession(stored: AuthUser) {
    user.value = stored;
    session.value = stored;
  }

  function endSession() {
    user.value = null;
    error.value = null;
    session.value = null;
  }

  /**
   * Восстановление сессии при загрузке приложения:
   * токен из localStorage + сверка с GET /auth/me.
   */
  async function init(): Promise<void> {
    if (!import.meta.client || restored) return;
    restored = true;

    if (!user.value && session.value) user.value = session.value;
    if (!user.value || user.value.source !== "api") return;

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

  function localLogin(login: string, password: string): boolean {
    const stored =
      findUser(login) ??
      readCustomUsers().find(
        (item) => item.login.toLowerCase() === login.toLowerCase(),
      );

    if (!stored || effectivePassword(stored) !== password) {
      error.value = "Неверный e-mail или пароль";
      return false;
    }

    startSession({
      id: stored.id,
      login: stored.login,
      roles: stored.roles,
      isAdmin: stored.isAdmin,
      createdAt: stored.createdAt,
      source: "local",
    });

    return true;
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
        const apiError = toApiError(err);

        // 401 — неверные учётные данные; 422 — не e-mail (локальные демо-аккаунты)
        if (apiError.status === 401 || apiError.status === 422) {
          return localLogin(email, password);
        }

        error.value = humanizeError(apiError);
        return false;
      }
    } finally {
      pending.value = false;
    }
  }

  async function register(payload: RegisterPayload): Promise<boolean> {
    pending.value = true;
    error.value = null;

    try {
      const email = payload.login.trim();
      const password = payload.password;
      const firstName = payload.firstName.trim();
      const lastName = payload.lastName.trim();

      if (!email || !password || !firstName || !lastName) {
        error.value = "Заполните все поля";
        return false;
      }

      try {
        await authApi.register({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
        });
      } catch (err) {
        error.value = humanizeError(toApiError(err));
        return false;
      }

      // API не выдаёт токен при регистрации — логинимся сразу
      try {
        const tokenResponse = await authApi.login({ email, password });
        setToken(tokenResponse.access_token, tokenResponse.expires_in);

        const me = await authApi.me({ force: true });
        startSession(toAuthUser(me));

        return true;
      } catch {
        error.value =
          "Аккаунт создан, но автоматический вход не удался. Войдите вручную.";
        return false;
      }
    } finally {
      pending.value = false;
    }
  }

  async function createUser(input: NewUser) {
    pending.value = true;
    error.value = null;

    try {
      const login = input.login.trim();
      const password = input.password;

      if (!login || !password) {
        error.value = "Укажите логин и пароль";
        return null;
      }

      if (findUser(login)) {
        error.value = "Пользователь с таким логином уже существует";
        return null;
      }

      const list = readCustomUsers();

      if (list.some((item) => item.login.toLowerCase() === login.toLowerCase())) {
        error.value = "Пользователь с таким логином уже существует";
        return null;
      }

      const stored: StoredUser = {
        id: createId("user"),
        login,
        password,
        roles: [...input.roles],
        isAdmin: input.roles.includes("admin"),
        createdAt: new Date().toISOString(),
        source: "local",
      };

      writeCustomUsers([...list, stored]);
      customUsers.value = [...list, stored];

      return stored;
    } finally {
      pending.value = false;
    }
  }

  function deleteUser(id: string) {
    if (MOCK_IDS.has(id)) return;

    const list = readCustomUsers().filter((item) => item.id !== id);

    writeCustomUsers(list);
    customUsers.value = list;

    if (user.value?.id === id) {
      clearToken();
      endSession();
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

  async function changePassword(current: string, next: string) {
    if (!user.value) {
      return { ok: false as const, error: "Сессия не найдена" };
    }

    if (!current || !next) {
      return { ok: false as const, error: "Заполните оба поля" };
    }

    if (next.length < 6) {
      return { ok: false as const, error: "Новый пароль — минимум 6 символов" };
    }

    if (user.value.source === "api") {
      return {
        ok: false as const,
        error: "Смена пароля недоступна: в API нет такого endpoint",
      };
    }

    const stored =
      readCustomUsers().find((item) => item.id === user.value!.id) ??
      MOCK_USERS.find((item) => item.id === user.value!.id);

    if (!stored) {
      return { ok: false as const, error: "Пользователь не найден" };
    }

    if (effectivePassword(stored) !== current) {
      return { ok: false as const, error: "Текущий пароль неверен" };
    }

    const overrides = readPasswordOverrides();

    overrides[stored.id] = next;
    writePasswordOverrides(overrides);

    return { ok: true as const };
  }

  return {
    user,
    pending,
    error,
    customUsers,
    users,
    isAuthenticated,
    init,
    endSession,
    loadUsers,
    login,
    register,
    createUser,
    deleteUser,
    logout,
    clearError,
    changePassword,
  };
});
