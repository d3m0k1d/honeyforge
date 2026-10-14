export type QueryParams = Record<string, unknown>;

/**
 * Сериализация query-параметров в формате, который ожидает FastAPI:
 * повторяющиеся ключи для массивов (`?tag=a&tag=b`), пустые значения
 * сохраняются, `undefined`/`null` пропускаются.
 */
export function serializeParams(params?: QueryParams | null): string {
  if (!params) return "";

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        search.append(key, String(item));
      }
      continue;
    }

    search.append(key, String(value));
  }

  return search.toString();
}
