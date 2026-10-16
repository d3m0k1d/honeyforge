import { onUnauthorized } from "~/api/http";

/**
 * Клиентская сессия: восстановление токена через GET /auth/me
 * и централизованная обработка истёкшей сессии (401).
 */
export default defineNuxtPlugin(() => {
  const auth = useAuthStore();
  const router = useRouter();

  onUnauthorized(() => {
    auth.endSession();

    const current = router.currentRoute.value;

    if (current.path !== "/login") {
      void router.push(
        `/login?redirect=${encodeURIComponent(current.fullPath)}`,
      );
    }
  });

  void auth.init();
});
