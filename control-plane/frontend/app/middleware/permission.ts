/**
 * Доступ к странице по permission из ролей API.
 *
 * Неаутризованные посетители проходят на чтение (поведение не меняется);
 * вошедшие без нужного права отправляются на главную.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore();
  const permission = to.meta.permission;

  if (!auth.isAuthenticated || typeof permission !== "string") return;

  if (!auth.can(permission)) return navigateTo("/");
});
