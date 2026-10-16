import { defineStore } from "pinia";
import { resources } from "~/api/resources";
import { toApiError } from "~/api/errors";
import { clearCache } from "~/api/cache";
import type { AgentRead } from "~/types/api";

export const useAgentsStore = defineStore("agents", () => {
  const auth = useAuthStore();
  const agents = ref<AgentRead[]>([]);
  const pending = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const onlineCount = computed(() => loaded.value && !error.value
    ? new Set(agents.value.filter((agent) => agent.online).map((agent) => agent.agent_id)).size
    : null);
  let inflight: Promise<void> | null = null;
  let generation = 0;

  watch(() => [auth.user, auth.can("agents:read")], () => {
    generation++;
    clearCache();
    inflight = null;
    agents.value = [];
    pending.value = false;
    loaded.value = false;
    error.value = null;
  }, { flush: "sync" });

  function load(): Promise<void> {
    if (inflight) return inflight;
    agents.value = [];
    error.value = null;
    loaded.value = false;
    if (!auth.can("agents:read")) {
      error.value = "Нет права agents:read";
      return Promise.resolve();
    }
    pending.value = true;
    const request = generation;
    inflight = (async () => {
      try {
        const rows = await resources.agents.list({ cache: { force: true, swr: false, persist: false } });
        if (request !== generation) return;
        agents.value = rows;
        loaded.value = true;
      } catch (err) {
        if (request !== generation) return;
        agents.value = [];
        error.value = toApiError(err).message;
      } finally {
        if (request === generation) {
          pending.value = false;
          inflight = null;
        }
      }
    })();
    return inflight;
  }

  return { agents, pending, loaded, error, onlineCount, load };
});
