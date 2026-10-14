import { serializeParams, type QueryParams } from "./params";

export interface CachePolicy {
  /** Свежее окно кэша, мс. 0 — не кэшировать. По умолчанию 30 с. */
  ttl?: number;
  /** Окно «устаревшего», но ещё пригодного к выдаче данных, мс. По умолчанию 5 мин. */
  staleTtl?: number;
  /** Теги для пакетной инвалидации (например, `profiles`). */
  tags?: string[];
  /** Сохранять запись в localStorage (переживает перезагрузку). */
  persist?: boolean;
  /** Отдавать stale-данные сразу и обновлять их в фоне (SWR). */
  swr?: boolean;
  /** Игнорировать кэш при чтении (всё равно дедуплицирует одинаковые запросы). */
  force?: boolean;
}

interface CacheEntry {
  data: unknown;
  freshUntil: number;
  staleUntil: number;
  tags: string[];
  storedAt: number;
  persist: boolean;
}

export const DEFAULT_TTL = 30_000;
export const DEFAULT_STALE_TTL = 5 * 60_000;

const MEMORY_LIMIT = 300;
const PERSIST_LIMIT = 40;
const PERSIST_KEY = "honeypotforge:api-cache";
const PERSIST_VERSION = 1;
const PERSIST_DELAY = 200;
const PERSIST_MAX_BYTES = 400_000;

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function isClient(): boolean {
  return import.meta.client;
}

/** Стабильный ключ запроса: url + отсортированные query-параметры. */
export function cacheKey(url: string, params?: QueryParams | null): string {
  const query = serializeParams(params);
  return query ? `${url}?${query}` : url;
}

/** Первый сегмент пути как тег записи: `/profiles/1` → `profiles`. */
export function tagsFor(url: string): string[] {
  const clean = url.split("?")[0]!.split("#")[0]!;
  const [first] = clean.split("/").filter(Boolean);

  return first ? [first] : [];
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;

  if (!isClient()) return;

  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      version?: number;
      entries?: Array<[string, CacheEntry]>;
    };

    if (parsed?.version !== PERSIST_VERSION || !Array.isArray(parsed.entries)) {
      localStorage.removeItem(PERSIST_KEY);
      return;
    }

    const now = Date.now();

    for (const [key, entry] of parsed.entries) {
      if (
        !entry ||
        typeof entry.staleUntil !== "number" ||
        entry.staleUntil <= now
      ) {
        continue;
      }

      memory.set(key, {
        ...entry,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        persist: true,
      });
    }
  } catch {
    // повреждённый кэш — просто начинаем заново
  }
}

function evictOverflow(): void {
  if (memory.size <= MEMORY_LIMIT) return;

  const byAge = [...memory.entries()].sort(
    (a, b) => a[1].storedAt - b[1].storedAt,
  );

  for (const [key] of byAge) {
    if (memory.size <= MEMORY_LIMIT) break;
    memory.delete(key);
  }
}

function persistNow(): void {
  if (!isClient()) return;

  try {
    const entries = [...memory.entries()]
      .filter(([, entry]) => entry.persist)
      .sort((a, b) => b[1].storedAt - a[1].storedAt)
      .slice(0, PERSIST_LIMIT);

    let payload = JSON.stringify({ version: PERSIST_VERSION, entries });

    while (payload.length > PERSIST_MAX_BYTES && entries.length > 1) {
      entries.length = Math.max(1, Math.floor(entries.length / 2));
      payload = JSON.stringify({ version: PERSIST_VERSION, entries });
    }

    localStorage.setItem(PERSIST_KEY, payload);
  } catch {
    // quota / недоступность localStorage — кэш остаётся только в памяти
  }
}

function schedulePersist(): void {
  if (!isClient() || persistTimer) return;

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DELAY);
}

export interface CacheHit {
  data: unknown;
  fresh: boolean;
}

export function readCache(key: string): CacheHit | null {
  hydrate();

  const entry = memory.get(key);
  if (!entry) return null;

  const now = Date.now();

  if (entry.staleUntil <= now) {
    memory.delete(key);
    return null;
  }

  return { data: entry.data, fresh: entry.freshUntil > now };
}

export function writeCache(
  key: string,
  data: unknown,
  policy: CachePolicy = {},
  tags: string[] = [],
): void {
  const ttl = policy.ttl ?? DEFAULT_TTL;
  if (ttl <= 0) return;

  hydrate();

  const now = Date.now();
  const entryTags = [...new Set(tags.length ? tags : tagsFor(key))];

  const entry: CacheEntry = {
    data,
    freshUntil: now + ttl,
    staleUntil: now + ttl + (policy.staleTtl ?? DEFAULT_STALE_TTL),
    tags: entryTags,
    storedAt: now,
    persist: Boolean(policy.persist),
  };

  const previous = memory.get(key);
  if (previous?.persist && !entry.persist) entry.persist = true;

  memory.set(key, entry);
  evictOverflow();
  schedulePersist();
}

export function invalidateTags(tags: string[]): void {
  if (!tags.length) return;

  hydrate();

  const wanted = new Set(tags);
  let changed = false;

  for (const [key, entry] of memory) {
    if (entry.tags.some((tag) => wanted.has(tag))) {
      memory.delete(key);
      changed = true;
    }
  }

  if (changed) schedulePersist();
}

/** Полная очистка (вызывается при logout — данные могут быть пользовательскими). */
export function clearCache(): void {
  hydrate();
  memory.clear();
  inflight.clear();

  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  if (!isClient()) return;

  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    // noop
  }
}

/** Дедупликация: одинаковые запросы, летящие одновременно, склеиваются в один. */
export function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const request = factory().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

export function getCacheSize(): { entries: number; inflight: number } {
  return { entries: memory.size, inflight: inflight.size };
}
