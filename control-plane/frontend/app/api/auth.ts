import { cachedGet, mutate, post } from "./http";
import type {
  RoleName,
  RoleRead,
  TokenResponse,
  UserRead,
  UserRolesUpdate,
} from "~/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  first_name: string;
  last_name: string;
}

export interface MeOptions {
  /** Обойти кэш (например, при восстановлении сессии). */
  force?: boolean;
}

/**
 * Эндпоинты авторизации HoneypotForge API (Bearer JWT, /auth/*).
 */
export const authApi = {
  /** POST /auth/login → JWT access_token + expires_in (сек). */
  login(payload: LoginPayload): Promise<TokenResponse> {
    return post<TokenResponse>("/auth/login", payload, {
      invalidate: ["auth"],
      timeout: 15_000,
    });
  },

  /** POST /auth/register — новый пользователь с ролью viewer. */
  register(payload: RegisterPayload): Promise<UserRead> {
    return post<UserRead>("/auth/register", payload, {
      invalidate: ["auth"],
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

  /** PUT /auth/users/{user_id}/roles — обновление ролей (нужен permission roles:manage). */
  updateUserRoles(userId: number, roles: RoleName[]): Promise<UserRead> {
    const body: UserRolesUpdate = { roles };

    return mutate<UserRead>({
      method: "put",
      url: `/auth/users/${userId}/roles`,
      data: body,
      invalidate: ["auth"],
    });
  },
};
