export type AuthMode = "login" | "register";

export interface AuthUser {
  id: string;
  login: string;
  roles: string[];
  isAdmin: boolean;
  createdAt: string;
}

export interface StoredUser extends AuthUser {
  password: string;
}

export interface Credentials {
  login: string;
  password: string;
}

export interface NewUser extends Credentials {
  roles: string[];
}
