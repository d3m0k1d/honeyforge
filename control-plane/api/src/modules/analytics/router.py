from datetime import UTC, datetime
from typing import Annotated, Any, TypeAlias

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import Agent, AgentEvent
from modules.auth.dependencies import requires
from modules.auth.schemas import PermissionName

router = APIRouter(prefix="/analytics", tags=["analytics"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


@router.get("/overview", dependencies=requires(PermissionName.ANALYTICS_READ))
async def overview(
    session: Session,
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    agent_id: Annotated[str | None, Query(max_length=128)] = None,
) -> dict[str, Any]:
    query = select(AgentEvent).join(Agent)
    if since is not None:
        query = query.where(AgentEvent.ts >= since)
    if until is not None:
        query = query.where(AgentEvent.ts <= until)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    base = query.subquery()
    total = await session.scalar(select(func.count()).select_from(base)) or 0
    services = await session.execute(
        select(base.c.service, func.count())
        .group_by(base.c.service)
        .order_by(desc(func.count()))
        .limit(50)
    )
    events = await session.execute(
        select(base.c.event, func.count())
        .group_by(base.c.event)
        .order_by(desc(func.count()))
        .limit(50)
    )
    sources = await session.execute(
        select(base.c.src, func.count())
        .where(base.c.src.is_not(None))
        .group_by(base.c.src)
        .order_by(desc(func.count()))
        .limit(50)
    )
    return {
        "total": total,
        "by_service": {key: value for key, value in services},
        "by_event": {key: value for key, value in events},
        "top_sources": {key: value for key, value in sources},
        "generated_at": datetime.now(UTC),
    }
