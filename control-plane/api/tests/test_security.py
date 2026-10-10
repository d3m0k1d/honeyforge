import asyncio

import jwt
import pytest
from fastapi import HTTPException

from core.config import Settings
from db.models import Permission, Role, User
from modules.auth.dependencies import require_permissions
from modules.auth.middleware import PUBLIC_PATHS
from modules.auth.schemas import PermissionName
from modules.auth.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hash_round_trip() -> None:
    hashed = hash_password("a-long-test-password")

    assert hashed != "a-long-test-password"
    assert verify_password("a-long-test-password", hashed)
    assert not verify_password("wrong-password", hashed)


def test_access_token_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Settings, "JWT_SECRET", "x" * 32)

    token, expires_in = create_access_token(42)

    assert decode_access_token(token) == 42
    assert expires_in == Settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60


def test_rejects_token_signed_with_another_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(Settings, "JWT_SECRET", "x" * 32)
    token = jwt.encode(
        {"sub": "42", "type": "access"},
        "y" * 32,
        algorithm=Settings.JWT_ALGORITHM,
    )

    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(token)


def test_requires_long_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Settings, "JWT_SECRET", "short")

    with pytest.raises(RuntimeError, match="at least 32"):
        create_access_token(42)


def test_permission_dependency_allows_granted_permission() -> None:
    user = User(
        email="user@example.com",
        first_name="Test",
        last_name="User",
        hashed_password="unused",
        roles=[
            Role(
                name="viewer",
                permissions=[Permission(name=PermissionName.EVENTS_READ)],
            )
        ],
    )
    dependency = require_permissions(PermissionName.EVENTS_READ)

    assert asyncio.run(dependency(user)) is user


def test_permission_dependency_rejects_missing_permission() -> None:
    user = User(
        email="user@example.com",
        first_name="Test",
        last_name="User",
        hashed_password="unused",
        roles=[],
    )
    dependency = require_permissions(PermissionName.ROLES_MANAGE)

    with pytest.raises(HTTPException) as error:
        asyncio.run(dependency(user))

    assert error.value.status_code == 403


def test_authentication_middleware_public_paths_are_explicit() -> None:
    assert "/auth/login" in PUBLIC_PATHS
    assert "/auth/register" in PUBLIC_PATHS
    assert "/auth/me" not in PUBLIC_PATHS
    assert "/auth/roles" not in PUBLIC_PATHS
