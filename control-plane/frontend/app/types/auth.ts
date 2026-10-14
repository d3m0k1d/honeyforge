export type AuthMode = "login" | "register";

/** Источник сессии: реальный API или локальный демо-аккаунт браузера. */
export type AuthSource = "api" | "local";

export interface AuthUser {
  id: string;
  login: string;
  roles: string[];
  isAdmin: boolean;
  createdAt: string;
  source?: AuthSource;
  firstName?: string;
  lastName?: string;
  /** Права, собранные из ролей API-пользователя. */
  permissions?: string[];
}

export interface StoredUser extends AuthUser {
  password: string;
}

export interface Credentials {
  login: string;
  password: string;
}

export interface RegisterPayload extends Credentials {
  firstName: string;
  lastName: string;
}

export interface NewUser extends Credentials {
  roles: string[];
}
