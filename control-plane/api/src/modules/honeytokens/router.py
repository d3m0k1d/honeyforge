from typing import Annotated, TypeAlias

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import Honeytoken
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName
from modules.honeytokens.schemas import (
    HoneytokenCreate,
    HoneytokenDetail,
    HoneytokenRead,
)

router = APIRouter(prefix="/honeytokens", tags=["honeytokens"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


async def get_honeytoken_or_404(
    session: AsyncSession, honeytoken_id: int
) -> Honeytoken:
    honeytoken = await session.get(Honeytoken, honeytoken_id)
    if honeytoken is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Honeytoken not found",
        )
    return honeytoken


@router.post(
    "",
    response_model=HoneytokenDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.HONEYTOKENS_MANAGE),
)
async def create_honeytoken(
    payload: HoneytokenCreate,
    user: CurrentUser,
    session: Session,
) -> Honeytoken:
    honeytoken = Honeytoken(
        user_id=user.id,
        **payload.model_dump(mode="json"),
    )
    session.add(honeytoken)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A honeytoken with this name already exists",
        ) from None

    await session.refresh(honeytoken)
    return honeytoken


@router.get(
    "",
    response_model=list[HoneytokenRead],
    dependencies=requires(PermissionName.HONEYTOKENS_READ),
)
async def list_honeytokens(
    session: Session,
    active: bool | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[Honeytoken]:
    query = select(Honeytoken).order_by(Honeytoken.created_at.desc())
    if active is not None:
        query = query.where(Honeytoken.is_active == active)
    result = await session.scalars(query.offset(offset).limit(limit))
    return list(result)


@router.get(
    "/{honeytoken_id}",
    response_model=HoneytokenDetail,
    dependencies=requires(PermissionName.HONEYTOKENS_READ),
)
async def get_honeytoken(honeytoken_id: int, session: Session) -> Honeytoken:
    return await get_honeytoken_or_404(session, honeytoken_id)


@router.put(
    "/{honeytoken_id}",
    response_model=HoneytokenDetail,
    dependencies=requires(PermissionName.HONEYTOKENS_MANAGE),
)
async def update_honeytoken(
    honeytoken_id: int,
    payload: HoneytokenCreate,
    session: Session,
) -> Honeytoken:
    honeytoken = await get_honeytoken_or_404(session, honeytoken_id)
    for field, value in payload.model_dump(mode="json").items():
        setattr(honeytoken, field, value)

    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A honeytoken with this name already exists",
        ) from None

    await session.refresh(honeytoken)
    return honeytoken


@router.delete(
    "/{honeytoken_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.HONEYTOKENS_MANAGE),
)
async def delete_honeytoken(honeytoken_id: int, session: Session) -> Response:
    honeytoken = await get_honeytoken_or_404(session, honeytoken_id)
    await session.delete(honeytoken)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Honeytoken with trigger history must be deactivated, not deleted",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
