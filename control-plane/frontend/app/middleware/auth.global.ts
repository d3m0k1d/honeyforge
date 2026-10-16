/**
 * Глобальная защита маршрутов.
 *
 * Неаутризованный посетитель видит только /login; все остальные страницы
 * (включая главную) перенаправляются на вход с redirect-параметром.
 * Вошедший без нужного permission из меты уходит на главную.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore();

  if (to.path === "/login") {
    if (auth.isAuthenticated) return navigateTo("/");
    return;
  }

  if (!auth.isAuthenticated) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }

  const permission = to.meta.permission;

  if (typeof permission === "string" && !auth.can(permission)) {
    return navigateTo("/");
  }
});
