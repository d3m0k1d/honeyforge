import { defineStore } from "pinia";
import type { AuthUser, Credentials, NewUser, StoredUser } from "~/types/auth";
import mockUsers from "~/data/users.json";

const USERS_KEY = "honeypotforge:custom-users";
const SESSION_COOKIE = "honeypotforge:session";
const PASSWORD_OVERRIDES_KEY = "honeypotforge:password-overrides";
const REQUEST_DELAY = 500;

const MOCK_USERS = mockUsers as unknown as StoredUser[];
const MOCK_IDS = new Set(MOCK_USERS.map((user) => user.id));

function isClient() {
  return import.meta.client;
}

function createId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${prefix}_${random}`;
}

function request() {
  return new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
}

function findUser(login: string) {
  const query = login.trim().toLowerCase();

  return MOCK_USERS.find((user) => user.login.toLowerCase() === query);
}

function readPasswordOverrides(): Record<string, string> {
  if (!isClient()) return {};

  try {
    const raw = localStorage.getItem(PASSWORD_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePasswordOverrides(map: Record<string, string>) {
  if (!isClient()) return;

  localStorage.setItem(PASSWORD_OVERRIDES_KEY, JSON.stringify(map));
}

function effectivePassword(stored: StoredUser) {
  return readPasswordOverrides()[stored.id] ?? stored.password;
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

  function readCustomUsers(): StoredUser[] {
    if (!isClient()) return [];

    try {
      const raw = localStorage.getItem(USERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];

      return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
    } catch {
      return [];
    }
  }

  function writeCustomUsers(list: StoredUser[]) {
    if (!isClient()) return;

    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }

  function loadUsers() {
    customUsers.value = readCustomUsers();
  }

  function startSession(stored: StoredUser) {
    const authUser: AuthUser = {
      id: stored.id,
      login: stored.login,
      roles: stored.roles,
      isAdmin: stored.isAdmin,
      createdAt: stored.createdAt,
    };

    user.value = authUser;
    session.value = authUser;
  }

  function endSession() {
    user.value = null;
    error.value = null;
    session.value = null;
  }

  async function login(credentials: Credentials) {
    pending.value = true;
    error.value = null;

    try {
      const login = credentials.login.trim();
      const password = credentials.password;

      if (!login || !password) {
        error.value = "Укажите логин и пароль";
        return false;
      }

      await request();

      const stored =
        findUser(login) ??
        readCustomUsers().find(
          (item) => item.login.toLowerCase() === login.toLowerCase(),
        );

      if (!stored || effectivePassword(stored) !== password) {
        error.value = "Неверный логин или пароль";
        return false;
      }

      startSession(stored);

      return true;
    } finally {
      pending.value = false;
    }
  }

  async function register(credentials: Credentials) {
    pending.value = true;
    error.value = null;

    try {
      const login = credentials.login.trim();
      const password = credentials.password;

      if (!login || !password) {
        error.value = "Укажите логин и пароль";
        return false;
      }

      const created = await createUser({ login, password, roles: [] });

      if (!created) return false;

      startSession(created);

      return true;
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

      await request();

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

    if (user.value?.id === id) endSession();
  }

  function logout() {
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

    await request();

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
