from datetime import UTC, datetime
from typing import Annotated, Any, TypeAlias

from fastapi import APIRouter, Depends, HTTPException, Query
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
    src: Annotated[str | None, Query(max_length=512)] = None,
    event: Annotated[str | None, Query(max_length=256)] = None,
    service: Annotated[str | None, Query(max_length=256)] = None,
) -> dict[str, Any]:
    if any(value is not None and value.utcoffset() is None for value in (since, until)):
        raise HTTPException(422, "Time filters must include a timezone")
    if since is not None and until is not None and since > until:
        raise HTTPException(422, "since must not be after until")

    query = select(AgentEvent).join(Agent)
    if since is not None:
        query = query.where(AgentEvent.ts >= since)
    if until is not None:
        query = query.where(AgentEvent.ts <= until)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    if src is not None:
        query = query.where(AgentEvent.src == src)
    if event is not None:
        query = query.where(AgentEvent.event == event)
    if service is not None:
        query = query.where(AgentEvent.service == service)
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
    levels = await session.execute(
        select(base.c.level, func.count())
        .where(base.c.level.is_not(None))
        .group_by(base.c.level)
        .order_by(desc(func.count()))
    )
    geo = func.coalesce(
        base.c.data["geo"].as_string(), base.c.data["country"].as_string()
    )
    geo_rows = await session.execute(
        select(geo, func.count())
        .where(base.c.data.is_not(None), geo.is_not(None))
        .group_by(geo)
        .order_by(desc(func.count()))
        .limit(50)
    )
    asn = base.c.data["asn"].as_string()
    asn_rows = await session.execute(
        select(asn, func.count())
        .where(base.c.data.is_not(None), asn.is_not(None))
        .group_by(asn)
        .order_by(desc(func.count()))
        .limit(50)
    )
    unique_sources = await session.scalar(
        select(func.count(func.distinct(base.c.src))).where(base.c.src.is_not(None))
    )
    unique_agents = await session.scalar(
        select(func.count(func.distinct(base.c.agent_id)))
    )
    return {
        "total": total,
        "by_service": {key: value for key, value in services},
        "by_event": {key: value for key, value in events},
        "top_sources": {key: value for key, value in sources},
        "by_level": {key: value for key, value in levels},
        "by_geo": {key: value for key, value in geo_rows},
        "by_asn": {key: value for key, value in asn_rows},
        "unique_sources": unique_sources or 0,
        "unique_agents": unique_agents or 0,
        "generated_at": datetime.now(UTC),
    }
