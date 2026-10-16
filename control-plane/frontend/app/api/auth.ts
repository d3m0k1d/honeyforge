import { cachedGet, del, mutate, patch, post, put } from "./http";
import type {
  AdminPasswordReset,
  PermissionRead,
  RoleName,
  RoleRead,
  TokenResponse,
  UserCreate,
  UserProfileUpdate,
  UserRead,
  UserRolesUpdate,
  UserStatusUpdate,
} from "~/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface MeOptions {
  /** Обойти кэш (например, при восстановлении сессии). */
  force?: boolean;
}

/**
 * Эндпоинты авторизации HoneypotForge API (Bearer JWT, /auth/*).
 *
 * Управление пользователями (/auth/users, /auth/permissions) требует
 * прав users:read / users:manage / roles:read / roles:manage.
 */
export const authApi = {
  /** POST /auth/login → JWT access_token + expires_in (сек). */
  login(payload: LoginPayload): Promise<TokenResponse> {
    return post<TokenResponse>("/auth/login", payload, {
      invalidate: ["auth"],
      timeout: 15_000,
    });
  },

  /** POST /auth/register — создание пользователя (нужен permission users:manage). */
  createUser(payload: UserCreate): Promise<UserRead> {
    return post<UserRead>("/auth/register", payload, {
      invalidate: ["auth", "users"],
    });
  },

  /** GET /auth/me — текущий пользователь (короткий кэш на время жизни сессии). */
  me(options: MeOptions = {}): Promise<UserRead> {
    return cachedGet<UserRead>("/auth/me", {
      cache: {
        ttl: 30_000,
        staleTtl: 60_000,
        tags: ["auth"],
        swr: false,
        force: options.force,
      },
    });
  },

  /** GET /auth/users — список учётных записей (нужен permission users:read). */
  users(options: MeOptions = {}): Promise<UserRead[]> {
    return cachedGet<UserRead[]>("/auth/users", {
      cache: {
        ttl: 15_000,
        staleTtl: 60_000,
        tags: ["users"],
        swr: false,
        force: options.force,
      },
    });
  },

  /** GET /auth/users/{user_id} — одна учётная запись (нужен permission users:read). */
  user(userId: number): Promise<UserRead> {
    return cachedGet<UserRead>(`/auth/users/${userId}`, {
      cache: { ttl: 15_000, tags: ["users"], swr: false },
    });
  },

  /** PATCH /auth/users/{user_id} — правка e-mail/имени (нужен permission users:manage). */
  updateUserProfile(userId: number, payload: UserProfileUpdate): Promise<UserRead> {
    return mutate<UserRead>({
      method: "patch",
      url: `/auth/users/${userId}`,
      data: payload,
      invalidate: ["auth", "users"],
    });
  },

  /** PUT /auth/users/{user_id}/password — сброс пароля администратором (users:manage). */
  resetUserPassword(userId: number, payload: AdminPasswordReset): Promise<void> {
    return put<void>(`/auth/users/${userId}/password`, payload, {
      invalidate: false,
    });
  },

  /** PUT /auth/users/{user_id}/status — активация/деактивация (users:manage). */
  updateUserStatus(userId: number, payload: UserStatusUpdate): Promise<UserRead> {
    return put<UserRead>(`/auth/users/${userId}/status`, payload, {
      invalidate: ["auth", "users"],
    });
  },

  /** DELETE /auth/users/{user_id} — мягкая деактивация (users:manage). */
  deactivateUser(userId: number): Promise<void> {
    return del<void>(`/auth/users/${userId}`, { invalidate: ["auth", "users"] });
  },

  /** GET /auth/roles — список ролей с правами (нужен permission roles:read). */
  roles(options: MeOptions = {}): Promise<RoleRead[]> {
    return cachedGet<RoleRead[]>("/auth/roles", {
      cache: {
        ttl: 5 * 60_000,
        staleTtl: 5 * 60_000,
        tags: ["auth", "roles"],
        force: options.force,
      },
    });
  },

  /** GET /auth/permissions — все права с группами (нужен permission roles:read). */
  permissions(options: MeOptions = {}): Promise<PermissionRead[]> {
    return cachedGet<PermissionRead[]>("/auth/permissions", {
      cache: {
        ttl: 5 * 60_000,
        staleTtl: 5 * 60_000,
        tags: ["auth", "roles"],
        force: options.force,
      },
    });
  },

  /** PUT /auth/users/{user_id}/roles — обновление ролей (нужен permission roles:manage). */
  updateUserRoles(userId: number, roles: RoleName[]): Promise<UserRead> {
    const body: UserRolesUpdate = { roles };

    return mutate<UserRead>({
      method: "put",
      url: `/auth/users/${userId}/roles`,
      data: body,
      invalidate: ["auth", "users"],
    });
  },
};
