from collections.abc import Callable, Coroutine
from typing import Annotated, Any, TypeAlias

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.engine import get_session
from db.models import Role, User
from modules.auth.schemas import PermissionName
from modules.auth.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credentials_error

    try:
        user_id = decode_access_token(credentials.credentials)
    except (jwt.InvalidTokenError, RuntimeError):
        raise credentials_error from None

    result = await session.execute(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_error
    return user


CurrentUser: TypeAlias = Annotated[User, Depends(get_current_user)]


def require_permissions(
    *required: PermissionName,
) -> Callable[[CurrentUser], Coroutine[Any, Any, User]]:
    async def dependency(user: CurrentUser) -> User:
        granted = {
            permission.name for role in user.roles for permission in role.permissions
        }
        missing = set(required) - granted
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(sorted(missing))}",
            )
        return user

    return dependency
