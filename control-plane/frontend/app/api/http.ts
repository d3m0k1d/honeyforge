import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  cacheKey,
  clearCache,
  dedupe,
  invalidateTags,
  readCache,
  tagsFor,
  writeCache,
  type CachePolicy,
} from "./cache";
import { toApiError } from "./errors";
import { serializeParams, type QueryParams } from "./params";
import { clearToken, getToken } from "./token";

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_TIMEOUT = 20_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;
const UNAUTHORIZED_QUIET_MS = 3_000;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["get", "head", "options"]);
const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/register"];

interface RetriableConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
  /** Явное разрешение повторов для неидемпотентных методов. */
  retry?: boolean;
}

type UnauthorizedHandler = () => void;

let instance: AxiosInstance | null = null;
let lastUnauthorizedAt = 0;

const unauthorizedHandlers = new Set<UnauthorizedHandler>();

/** Подписка на истечение сессии (401) — стор снимает её в auth-плагине. */
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);

  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

function notifyUnauthorized(): void {
  const now = Date.now();
  if (now - lastUnauthorizedAt < UNAUTHORIZED_QUIET_MS) return;
  lastUnauthorizedAt = now;

  for (const handler of unauthorizedHandlers) {
    try {
      handler();
    } catch {
      // обработчик не должен ломать цепочку запросов
    }
  }
}

function defaultBaseUrl(): string {
  const fromEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.NUXT_PUBLIC_API_BASE;

  return fromEnv || DEFAULT_BASE_URL;
}

function shouldRetry(error: unknown, config: RetriableConfig): boolean {
  const attempt = config.__retryCount ?? 0;
  if (attempt >= MAX_RETRIES) return false;

  const method = (config.method ?? "get").toLowerCase();
  const isIdempotent = IDEMPOTENT_METHODS.has(method);

  // неидемпотентные методы повторяем только при явном разрешении (config.retry)
  if (!isIdempotent && config.retry !== true) return false;

  const axiosError = error as { response?: { status?: number } } | undefined;
  const status = axiosError?.response?.status;

  if (status === undefined) return true; // сеть / таймаут
  if (status === 401 || status === 403) return false;

  return RETRY_STATUSES.has(status);
}

function retryDelay(attempt: number): number {
  const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return backoff + Math.floor(Math.random() * 150);
}

function buildInstance(baseURL: string): AxiosInstance {
  const http = axios.create({
    baseURL: baseURL.replace(/\/+$/, ""),
    timeout: DEFAULT_TIMEOUT,
    headers: { Accept: "application/json" },
    paramsSerializer: { serialize: serializeParams },
  });

  http.interceptors.request.use((config) => {
    const token = getToken();

    if (token) {
      config.headers.set?.("Authorization", `Bearer ${token}`);
    }

    config.headers.set?.("Accept", "application/json");

    return config;
  });

  http.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (
        axios.isCancel?.(error) ||
        (error as { code?: string })?.code === "ERR_CANCELED"
      ) {
        return Promise.reject(error);
      }

      const config = (error as { config?: RetriableConfig })?.config;

      if (config && shouldRetry(error, config)) {
        config.__retryCount = (config.__retryCount ?? 0) + 1;

        return new Promise((resolve, reject) => {
          setTimeout(() => {
            http(config).then(resolve, reject);
          }, retryDelay(config.__retryCount!));
        });
      }

      const status = (error as { response?: { status?: number } })?.response
        ?.status;

      if (status === 401 && config?.url) {
        const isPublicAuthPath = PUBLIC_AUTH_PATHS.some((path) =>
          config.url!.includes(path),
        );

        if (!isPublicAuthPath) {
          clearToken();
          clearCache();
          notifyUnauthorized();
        }
      }

      return Promise.reject(toApiError(error));
    },
  );

  return http;
}

/** Инициализация singleton-инстанса (вызывается nuxt-плагином с runtime-конфигом). */
export function initHttp(baseURL?: string): AxiosInstance {
  if (instance) return instance;

  instance = buildInstance((baseURL ?? defaultBaseUrl()).trim() || DEFAULT_BASE_URL);
  return instance;
}

export function http(): AxiosInstance {
  return instance ?? initHttp();
}

export interface CachedGetConfig extends Omit<AxiosRequestConfig, "url" | "method"> {
  /** `false` — отключить кэш для этого запроса. */
  cache?: CachePolicy | false;
}

function normalizeParams(params?: QueryParams | Record<string, unknown>) {
  return params as QueryParams | undefined;
}

async function executeCachedGet<T>(
  key: string,
  url: string,
  config: AxiosRequestConfig,
  policy: CachePolicy,
  tags: string[],
): Promise<T> {
  return dedupe(key, async () => {
    const response = await http().get<T>(url, config);
    writeCache(key, response.data, policy, tags);

    return response.data;
  });
}

/**
 * GET с кэшем: свежие данные → мгновенно, stale → отдаются сразу и
 * обновляются в фоне, идентичные запросы склеиваются (dedupe).
 */
export async function cachedGet<T>(
  url: string,
  config: CachedGetConfig = {},
): Promise<T> {
  const { cache: cacheOption, ...rest } = config as AxiosRequestConfig & {
    cache?: CachePolicy | false;
  };

  if (cacheOption === false) {
    const response = await http().get<T>(url, rest);
    return response.data;
  }

  const policy: CachePolicy = { ...cacheOption };
  const params = normalizeParams(rest.params);
  const key = cacheKey(url, params);
  const tags = policy.tags?.length ? policy.tags : tagsFor(url);

  if (!policy.force) {
    const hit = readCache(key);

    if (hit) {
      if (hit.fresh) return hit.data as T;

      if (policy.swr !== false) {
        void executeCachedGet<T>(key, url, rest, policy, tags).catch(() => {
          // фоновое обновление: оставляем stale-данные, ошибка уйдёт в interceptor
        });

        return hit.data as T;
      }
    }
  }

  return executeCachedGet<T>(key, url, rest, policy, tags);
}

export interface MutateConfig extends AxiosRequestConfig {
  /** Теги для инвалидации кэша; `false` — не инвалидировать; по умолчанию — первый сегмент URL. */
  invalidate?: string[] | false;
  /** Явный повтор запроса при сетевой ошибке / 5xx (по умолчанию выключен для мутаций). */
  retry?: boolean;
}

/** Мутация (POST/PUT/PATCH/DELETE) с автоматической инвалидацией связанного кэша. */
export async function mutate<T>(config: MutateConfig): Promise<T> {
  const { invalidate, ...rest } = config;

  const response = await http().request<T>(rest);

  if (invalidate !== false) {
    const tags = invalidate ?? tagsFor(rest.url ?? "");
    invalidateTags(Array.isArray(tags) ? tags : [tags]);
  }

  return response.data;
}

export function post<T>(
  url: string,
  data?: unknown,
  config: MutateConfig = {},
): Promise<T> {
  return mutate<T>({ ...config, method: "post", url, data });
}

export function put<T>(
  url: string,
  data?: unknown,
  config: MutateConfig = {},
): Promise<T> {
  return mutate<T>({ ...config, method: "put", url, data });
}

export function patch<T>(
  url: string,
  data?: unknown,
  config: MutateConfig = {},
): Promise<T> {
  return mutate<T>({ ...config, method: "patch", url, data });
}

export function del<T = void>(
  url: string,
  config: MutateConfig = {},
): Promise<T> {
  return mutate<T>({ ...config, method: "delete", url });
}
