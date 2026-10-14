import type { AxiosError } from "axios";

export interface ApiErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
  cause?: unknown;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "Некорректный запрос",
  401: "Требуется авторизация",
  403: "Недостаточно прав",
  404: "Ресурс не найден",
  409: "Конфликт данных",
  422: "Проверьте корректность полей",
  429: "Слишком много запросов, попробуйте позже",
  500: "Внутренняя ошибка сервера",
  502: "Сервис временно недоступен",
  503: "Сервис временно недоступен",
  504: "Сервис не отвечает",
};

export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

function fastapiMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail || null;

  if (Array.isArray(detail)) {
    const parts = detail.flatMap((item) => {
      if (!item || typeof item !== "object") return [];

      const record = item as Record<string, unknown>;
      const message = typeof record.msg === "string" ? record.msg : "";
      const location = Array.isArray(record.loc)
        ? record.loc
            .filter((part) => typeof part === "string" && part !== "body" && part !== "query" && part !== "path")
            .join(".")
        : "";

      if (!message && !location) return [];
      return [location ? `${location}: ${message}` : message];
    });

    return parts.length ? parts.join("; ") : null;
  }

  return null;
}

function statusFallback(status?: number, hasResponse = true): string {
  if (!hasResponse) return "Нет связи с сервером";
  if (status && STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status && status >= 500) return "Сервис временно недоступен";
  return "Неизвестная ошибка запроса";
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const axiosError = error as AxiosError<unknown> | undefined;

  if (axiosError?.isAxiosError) {
    const response = axiosError.response;
    const status = response?.status;
    const data = response?.data as { detail?: unknown } | undefined;
    const detail = data && typeof data === "object" ? data.detail : undefined;

    const message = fastapiMessage(detail) ?? statusFallback(status, Boolean(response));

    return new ApiError(message, {
      status,
      code: axiosError.code,
      details: detail,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ApiError(error.message || "Неизвестная ошибка", { cause: error });
  }

  return new ApiError("Неизвестная ошибка", { cause: error });
}
