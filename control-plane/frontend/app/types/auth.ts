export interface AuthUser {
  id: string;
  /** Числовой id в API (нужен для админских эндпоинтов). */
  numericId: number;
  login: string;
  roles: string[];
  isAdmin: boolean;
  createdAt: string;
  firstName?: string;
  lastName?: string;
  /** Права, собранные из ролей API. */
  permissions?: string[];
}

export interface Credentials {
  login: string;
  password: string;
}
