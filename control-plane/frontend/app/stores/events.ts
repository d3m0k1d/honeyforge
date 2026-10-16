import { defineStore } from "pinia";
import { resources } from "~/api/resources";
import { toApiError } from "~/api/errors";
import { clearCache } from "~/api/cache";
import type { EventRead, EventStats } from "~/types/api";

export const useEventsStore = defineStore("events", () => {
  const events = ref<EventRead[]>([]);
  const stats = ref<EventStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const limit = 1000;
  const auth = useAuthStore();
  let generation = 0;

  function clear() {
    generation++;
    events.value = [];
    stats.value = null;
    error.value = null;
    loading.value = false;
  }

  watch(() => [auth.user, auth.can("events:read")], () => {
    // Forced GETs still deduplicate; never join a previous session's request.
    clearCache();
    clear();
  }, { flush: "sync" });

  async function load() {
    if (!auth.can("events:read")) {
      clear();
      error.value = "Нет права events:read для просмотра событий";
      return;
    }
    if (loading.value) return;

    const request = ++generation;
    loading.value = true;
    error.value = null;
    const options = { cache: { force: true, swr: false, persist: false } };
    try {
      const results = await Promise.allSettled([
        resources.events.list({ offset: 0, limit }, options),
        resources.events.stats({}, options),
      ]);
      if (request !== generation) return;
      const [list, totals] = results;
      events.value = list.status === "fulfilled" ? list.value : [];
      stats.value = list.status === "fulfilled" && totals.status === "fulfilled" ? totals.value : null;
      error.value = results.flatMap((result) => result.status === "rejected"
        ? [toApiError(result.reason).message] : []).join("; ") || null;
    } finally {
      if (request === generation) loading.value = false;
    }
  }

  return { events, stats, loading, error, limit, load };
});
