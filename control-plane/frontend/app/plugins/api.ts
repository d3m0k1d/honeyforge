import { initHttp } from "~/api/http";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();

  initHttp(String(config.public.apiBase));
});
