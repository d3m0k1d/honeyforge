from sqlalchemy import select
from sqlalchemy.orm import selectinload

from core.config import Settings
from db.engine import async_session, engine
from db.models import Base, Permission, Role, User
from modules.auth.schemas import PermissionName, RoleName
from modules.auth.security import hash_password

ROLE_PERMISSIONS = {
    RoleName.ADMIN: set(PermissionName),
    RoleName.OPERATOR: {
        PermissionName.HONEYPOTS_READ,
        PermissionName.HONEYPOTS_MANAGE,
        PermissionName.HONEYTOKENS_READ,
        PermissionName.HONEYTOKENS_MANAGE,
        PermissionName.AGENTS_READ,
        PermissionName.AGENTS_MANAGE,
        PermissionName.DEPLOYMENTS_READ,
        PermissionName.DEPLOYMENTS_MANAGE,
        PermissionName.PROFILES_READ,
        PermissionName.PROFILES_MANAGE,
        PermissionName.EVENTS_READ,
        PermissionName.SESSIONS_READ,
        PermissionName.ARTIFACTS_READ,
        PermissionName.ALERTS_READ,
        PermissionName.ALERTS_MANAGE,
        PermissionName.DATABASES_READ,
        PermissionName.DATABASES_MANAGE,
        PermissionName.ANALYTICS_READ,
    },
    RoleName.VIEWER: {
        PermissionName.HONEYPOTS_READ,
        PermissionName.HONEYTOKENS_READ,
        PermissionName.AGENTS_READ,
        PermissionName.DEPLOYMENTS_READ,
        PermissionName.PROFILES_READ,
        PermissionName.EVENTS_READ,
        PermissionName.SESSIONS_READ,
        PermissionName.ARTIFACTS_READ,
        PermissionName.ALERTS_READ,
        PermissionName.DATABASES_READ,
        PermissionName.ANALYTICS_READ,
    },
}


async def init_db() -> None:
    if not Settings.JWT_SECRET or len(Settings.JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters")
    if not Settings.AGENT_GATEWAY_TOKEN or len(Settings.AGENT_GATEWAY_TOKEN) < 32:
        raise RuntimeError("AGENT_GATEWAY_TOKEN must contain at least 32 characters")
    if bool(Settings.INITIAL_ADMIN_EMAIL) != bool(Settings.INITIAL_ADMIN_PASSWORD):
        raise RuntimeError(
            "INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set together"
        )
    if Settings.INITIAL_ADMIN_PASSWORD and len(Settings.INITIAL_ADMIN_PASSWORD) < 12:
        raise RuntimeError("INITIAL_ADMIN_PASSWORD must contain at least 12 characters")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        permissions = {
            permission.name: permission
            for permission in (await session.scalars(select(Permission))).all()
        }
        for name in PermissionName:
            if name not in permissions:
                permission = Permission(name=name)
                session.add(permission)
                permissions[name] = permission

        roles = {
            role.name: role
            for role in (
                await session.scalars(
                    select(Role).options(selectinload(Role.permissions))
                )
            ).all()
        }
        for name, permission_names in ROLE_PERMISSIONS.items():
            role = roles.get(name)
            if role is None:
                role = Role(name=name)
                session.add(role)
                roles[name] = role
            role.permissions = [permissions[item] for item in permission_names]

        await session.flush()
        if Settings.INITIAL_ADMIN_EMAIL:
            email = Settings.INITIAL_ADMIN_EMAIL.lower()
            password = Settings.INITIAL_ADMIN_PASSWORD
            if password is None:
                raise RuntimeError("INITIAL_ADMIN_PASSWORD is required")
            admin = await session.scalar(select(User).where(User.email == email))
            if admin is None:
                admin = User(
                    email=email,
                    first_name="Initial",
                    last_name="Admin",
                    hashed_password=hash_password(password),
                    roles=[roles[RoleName.ADMIN]],
                )
                session.add(admin)

        await session.commit()
