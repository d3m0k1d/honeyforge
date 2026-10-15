export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore();

  if (!auth.isAuthenticated) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }

  // Админ-панель доступна владельцам прав на пользователей или роли
  if (!auth.canAny("users:read", "roles:read")) {
    return navigateTo("/");
  }
});
