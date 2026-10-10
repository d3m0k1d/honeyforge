from collections.abc import Callable, Coroutine
from typing import Annotated, Any, TypeAlias

from fastapi import Depends, HTTPException, Request, status
from fastapi.params import Depends as DependsParameter
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import User
from modules.auth.access import user_from_access_token, user_permissions
from modules.auth.schemas import PermissionName

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    middleware_user = getattr(request.state, "user", None)
    if middleware_user is not None:
        return middleware_user
    if credentials is None:
        raise credentials_error

    user = await user_from_access_token(session, credentials.credentials)
    if user is None:
        raise credentials_error
    return user


CurrentUser: TypeAlias = Annotated[User, Depends(get_current_user)]


def require_permissions(
    *required: PermissionName,
) -> Callable[[CurrentUser], Coroutine[Any, Any, User]]:
    async def dependency(user: CurrentUser) -> User:
        granted = user_permissions(user)
        missing = set(required) - granted
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(sorted(missing))}",
            )
        return user

    return dependency


def requires(*required: PermissionName) -> list[DependsParameter]:
    return [Depends(require_permissions(*required))]
