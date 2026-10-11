from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class PermissionName(StrEnum):
    USERS_READ = "users:read"
    USERS_MANAGE = "users:manage"
    ROLES_READ = "roles:read"
    ROLES_MANAGE = "roles:manage"
    HONEYPOTS_READ = "honeypots:read"
    HONEYPOTS_MANAGE = "honeypots:manage"
    HONEYTOKENS_READ = "honeytokens:read"
    HONEYTOKENS_MANAGE = "honeytokens:manage"
    AGENTS_READ = "agents:read"
    AGENTS_MANAGE = "agents:manage"
    EVENTS_READ = "events:read"


class RoleName(StrEnum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RoleRead(BaseModel):
    name: RoleName
    permissions: list[PermissionName]


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime
    roles: list[RoleRead]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserRolesUpdate(BaseModel):
    roles: set[RoleName] = Field(min_length=1)
