const TOKEN_KEY = "honeypotforge:token";
const EXPIRY_SKEW_MS = 15_000;
const DEFAULT_TTL_SECONDS = 60 * 60;

interface TokenRecord {
  token: string;
  expiresAt: number;
}

let memory: TokenRecord | null = null;
let loaded = false;

function read(): TokenRecord | null {
  if (loaded) return memory;
  loaded = true;
  memory = null;

  if (!import.meta.client) return null;

  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<TokenRecord> | null;

    if (
      !parsed ||
      typeof parsed.token !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }

    memory = parsed as TokenRecord;
  } catch {
    memory = null;
  }

  return memory;
}

/** Bearer-токен из localStorage; на сервере всегда null (запросы идут с клиента). */
export function getToken(): string | null {
  const record = read();
  if (!record) return null;

  if (record.expiresAt <= Date.now() + EXPIRY_SKEW_MS) {
    clearToken();
    return null;
  }

  return record.token;
}

export function setToken(token: string, expiresIn?: number): void {
  const ttlSeconds =
    typeof expiresIn === "number" && expiresIn > 0
      ? Math.min(expiresIn, 60 * 60 * 24)
      : DEFAULT_TTL_SECONDS;

  memory = { token, expiresAt: Date.now() + ttlSeconds * 1000 };
  loaded = true;

  if (!import.meta.client) return;

  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(memory));
  } catch {
    // localStorage недоступен (private mode) — токен останется только в памяти
  }
}

export function clearToken(): void {
  memory = null;
  loaded = true;

  if (!import.meta.client) return;

  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // noop
  }
}

export function hasToken(): boolean {
  return getToken() !== null;
}
