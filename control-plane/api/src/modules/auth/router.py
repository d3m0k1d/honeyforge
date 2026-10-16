from typing import Annotated, TypeAlias

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.engine import get_session
from db.models import Role, User
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import (
    AdminPasswordReset,
    LoginRequest,
    PermissionName,
    PermissionRead,
    RoleName,
    RoleRead,
    TokenResponse,
    UserCreate,
    UserProfileUpdate,
    UserRead,
    UserRolesUpdate,
    UserStatusUpdate,
)
from modules.auth.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


def user_response(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        is_active=user.is_active,
        created_at=user.created_at,
        roles=[
            RoleRead(
                name=role.name,
                permissions=sorted(permission.name for permission in role.permissions),
            )
            for role in user.roles
        ],
    )


async def load_user(session: AsyncSession, user_id: int) -> User | None:
    return await session.scalar(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.USERS_MANAGE),
)
async def register(payload: UserCreate, session: Session) -> UserRead:
    viewer = await session.scalar(
        select(Role)
        .where(Role.name == RoleName.VIEWER)
        .options(selectinload(Role.permissions))
    )
    if viewer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Roles are not initialized",
        )

    user = User(
        email=str(payload.email).lower(),
        first_name=payload.first_name,
        last_name=payload.last_name,
        hashed_password=hash_password(payload.password),
        roles=[viewer],
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        ) from None

    created = await load_user(session, user.id)
    if created is None:
        raise RuntimeError("Created user could not be loaded")
    return user_response(created)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: Session) -> TokenResponse:
    user = await session.scalar(
        select(User).where(User.email == str(payload.email).lower())
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )

    token, expires_in = create_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=expires_in)


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> UserRead:
    return user_response(user)


@router.get(
    "/users",
    response_model=list[UserRead],
    dependencies=requires(PermissionName.USERS_READ),
)
async def list_users(session: Session) -> list[UserRead]:
    users = (
        await session.scalars(
            select(User)
            .options(selectinload(User.roles).selectinload(Role.permissions))
            .order_by(User.created_at, User.id)
        )
    ).all()
    return [user_response(user) for user in users]


@router.get(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=requires(PermissionName.USERS_READ),
)
async def get_user(user_id: int, session: Session) -> UserRead:
    user = await load_user(session, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user_response(user)


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=requires(PermissionName.USERS_MANAGE),
)
async def update_user_profile(
    user_id: int, payload: UserProfileUpdate, session: Session
) -> UserRead:
    user = await load_user(session, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    user.email = str(payload.email).lower()
    user.first_name = payload.first_name
    user.last_name = payload.last_name
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "A user with this email already exists") from None
    updated = await load_user(session, user.id)
    if updated is None:
        raise RuntimeError("Updated user could not be loaded")
    return user_response(updated)


@router.put(
    "/users/{user_id}/password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.USERS_MANAGE),
)
async def reset_user_password(
    user_id: int, payload: AdminPasswordReset, session: Session
) -> None:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    user.hashed_password = hash_password(payload.password)
    await session.commit()


@router.put(
    "/users/{user_id}/status",
    response_model=UserRead,
    dependencies=requires(PermissionName.USERS_MANAGE),
)
async def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    current_user: CurrentUser,
    session: Session,
) -> UserRead:
    if user_id == current_user.id and not payload.is_active:
        raise HTTPException(409, "Users cannot deactivate themselves")
    user = await load_user(session, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    user.is_active = payload.is_active
    await session.commit()
    updated = await load_user(session, user.id)
    if updated is None:
        raise RuntimeError("Updated user could not be loaded")
    return user_response(updated)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.USERS_MANAGE),
)
async def deactivate_user(
    user_id: int, current_user: CurrentUser, session: Session
) -> None:
    if user_id == current_user.id:
        raise HTTPException(409, "Users cannot deactivate themselves")
    user = await load_user(session, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    user.is_active = False
    await session.commit()


@router.get(
    "/roles",
    response_model=list[RoleRead],
    dependencies=requires(PermissionName.ROLES_READ),
)
async def list_roles(
    session: Session,
) -> list[RoleRead]:
    roles = (
        await session.scalars(
            select(Role).options(selectinload(Role.permissions)).order_by(Role.name)
        )
    ).all()
    return [
        RoleRead(
            name=role.name,
            permissions=sorted(permission.name for permission in role.permissions),
        )
        for role in roles
    ]


@router.get(
    "/permissions",
    response_model=list[PermissionRead],
    dependencies=requires(PermissionName.ROLES_READ),
)
async def list_permissions() -> list[PermissionRead]:
    result = []
    for permission in PermissionName:
        group = permission.value.split(":", 1)[0]
        result.append(PermissionRead(name=permission, group=group))
    return result


@router.put(
    "/users/{user_id}/roles",
    response_model=UserRead,
    dependencies=requires(PermissionName.ROLES_MANAGE),
)
async def update_user_roles(
    user_id: int,
    payload: UserRolesUpdate,
    session: Session,
) -> UserRead:
    user = await load_user(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    roles = (
        await session.scalars(
            select(Role)
            .where(Role.name.in_(payload.roles))
            .options(selectinload(Role.permissions))
        )
    ).all()
    if len(roles) != len(payload.roles):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role"
        )

    user.roles = list(roles)
    await session.commit()
    updated = await load_user(session, user.id)
    if updated is None:
        raise RuntimeError("Updated user could not be loaded")
    return user_response(updated)
