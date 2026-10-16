import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Role, User
from modules.auth.security import decode_access_token


async def user_from_access_token(session: AsyncSession, token: str) -> User | None:
    try:
        user_id = decode_access_token(token)
    except (jwt.InvalidTokenError, RuntimeError):
        return None

    user = await session.scalar(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    if user is None or not user.is_active:
        return None
    return user


def user_permissions(user: User) -> set[str]:
    return {permission.name for role in user.roles for permission in role.permissions}
