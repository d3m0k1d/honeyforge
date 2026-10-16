from typing import Annotated, TypeAlias
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import Agent, AgentConfiguration, HoneypotProfile, Honeytoken
from modules.agents.schemas import AgentConfigRead
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName
from modules.profiles.schemas import (
    ProfileCreate,
    ProfileRead,
    ProfileUpdate,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


async def get_profile(session: AsyncSession, profile_id: UUID) -> HoneypotProfile:
    profile = await session.get(HoneypotProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


async def validate_honeytokens(
    session: AsyncSession, honeytoken_ids: list[int]
) -> None:
    if not honeytoken_ids:
        return
    found = set(
        await session.scalars(
            select(Honeytoken.id).where(
                Honeytoken.id.in_(honeytoken_ids), Honeytoken.is_active.is_(True)
            )
        )
    )
    if found != set(honeytoken_ids):
        raise HTTPException(
            status_code=422, detail="Profile contains missing or inactive honeytokens"
        )


def apply_profile(
    profile: HoneypotProfile, payload: ProfileCreate | ProfileUpdate
) -> None:
    values = payload.model_dump(mode="json")
    profile.name = values["name"]
    profile.description = values["description"]
    profile.level = values["level"]
    profile.services = values["services"]
    profile.logging = values["logging"]
    profile.masking = values["masking"]
    profile.honeytoken_ids = values["honeytoken_ids"]


@router.post(
    "",
    response_model=ProfileRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.PROFILES_MANAGE),
)
async def create_profile(
    payload: ProfileCreate, user: CurrentUser, session: Session
) -> HoneypotProfile:
    await validate_honeytokens(session, payload.honeytoken_ids)
    profile = HoneypotProfile(created_by_id=user.id)
    apply_profile(profile, payload)
    session.add(profile)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="Profile name already exists"
        ) from None
    await session.refresh(profile)
    return profile


@router.get(
    "",
    response_model=list[ProfileRead],
    dependencies=requires(PermissionName.PROFILES_READ),
)
async def list_profiles(session: Session) -> list[HoneypotProfile]:
    return list(
        await session.scalars(select(HoneypotProfile).order_by(HoneypotProfile.name))
    )


@router.get(
    "/{profile_id}",
    response_model=ProfileRead,
    dependencies=requires(PermissionName.PROFILES_READ),
)
async def read_profile(profile_id: UUID, session: Session) -> HoneypotProfile:
    return await get_profile(session, profile_id)


@router.put(
    "/{profile_id}",
    response_model=ProfileRead,
    dependencies=requires(PermissionName.PROFILES_MANAGE),
)
async def update_profile(
    profile_id: UUID, payload: ProfileUpdate, session: Session
) -> HoneypotProfile:
    profile = await get_profile(session, profile_id)
    await validate_honeytokens(session, payload.honeytoken_ids)
    apply_profile(profile, payload)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="Profile name already exists"
        ) from None
    await session.refresh(profile)
    return profile


@router.delete(
    "/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.PROFILES_MANAGE),
)
async def delete_profile(profile_id: UUID, session: Session) -> Response:
    profile = await get_profile(session, profile_id)
    await session.delete(profile)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{profile_id}/agents/{agent_id}",
    response_model=AgentConfigRead,
    response_model_exclude_unset=True,
    dependencies=requires(PermissionName.AGENTS_MANAGE),
)
async def assign_profile(profile_id: UUID, agent_id: str, session: Session) -> dict:
    profile = await get_profile(session, profile_id)
    agent = await session.scalar(
        select(Agent).where(Agent.external_id == agent_id).with_for_update()
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    honeytokens = []
    if profile.honeytoken_ids:
        rows = await session.scalars(
            select(Honeytoken).where(
                Honeytoken.id.in_(profile.honeytoken_ids),
                Honeytoken.is_active.is_(True),
            )
        )
        honeytokens = [
            {
                "id": item.id,
                "name": item.name,
                "file_name": item.file_name,
                "target_path": item.target_path,
                "content_type": item.content_type,
                "encoding": item.encoding,
                "content": item.content,
                "checksum_sha256": item.checksum_sha256,
            }
            for item in rows
        ]
    config = {
        "log": profile.logging,
        "services": profile.services,
        "masking": profile.masking,
        "honeytokens": honeytokens,
    }
    configuration = await session.get(AgentConfiguration, agent.id)
    if configuration is None:
        configuration = AgentConfiguration(
            agent_id=agent.id, profile_id=profile.id, version=1, config=config
        )
        session.add(configuration)
    else:
        configuration.profile_id = profile.id
        configuration.version += 1
        configuration.config = config
    await session.commit()
    return {**config, "version": configuration.version}
