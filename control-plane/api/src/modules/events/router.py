import asyncio
import csv
import ipaddress
import json
from datetime import UTC, datetime
from io import StringIO
from typing import Annotated, Any, TypeAlias
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from db.engine import async_session, get_session
from db.models import Agent, AgentEvent
from modules.auth.access import user_from_access_token, user_permissions
from modules.auth.dependencies import requires
from modules.auth.schemas import PermissionName
from modules.events.schemas import EventRead, EventStats

router = APIRouter(prefix="/events", tags=["events"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


def event_dict(event: AgentEvent, agent_id: str) -> dict[str, Any]:
    data = event.data or {}
    timestamp = event.ts.replace(tzinfo=UTC) if event.ts.tzinfo is None else event.ts
    return {
        "id": event.id,
        "event_id": event.event_id,
        "agent_id": agent_id,
        "ts": timestamp,
        "service": event.service,
        "level": event.level,
        "src": event.src,
        "event": event.event,
        "rule": event.rule,
        "data": event.data,
        "geo": data.get("geo") or data.get("country"),
        "asn": data.get("asn"),
        "protocol": data.get("protocol"),
        "source_port": data.get("source_port") or data.get("src_port"),
        "destination_port": data.get("destination_port") or data.get("dst_port"),
        "username": data.get("username"),
        "command": data.get("command"),
        "request": data.get("request"),
        "payload": data.get("payload"),
        "session_id": data.get("session_id"),
    }


def filtered_events(
    *,
    agent_id: str | None,
    since: datetime | None,
    until: datetime | None,
    src: str | None,
    event: str | None,
    service: str | None,
):
    if any(value is not None and value.utcoffset() is None for value in (since, until)):
        raise HTTPException(422, "Time filters must include a timezone")
    if since is not None and until is not None and since > until:
        raise HTTPException(422, "since must not be after until")
    query = select(AgentEvent, Agent.external_id).join(Agent)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    if since is not None:
        query = query.where(AgentEvent.ts >= since)
    if until is not None:
        query = query.where(AgentEvent.ts <= until)
    if src is not None:
        query = query.where(AgentEvent.src == src)
    if event is not None:
        query = query.where(AgentEvent.event == event)
    if service is not None:
        query = query.where(AgentEvent.service == service)
    return query


@router.get(
    "",
    response_model=list[EventRead],
    dependencies=requires(PermissionName.EVENTS_READ),
)
async def list_events(
    session: Session,
    agent_id: str | None = Query(default=None, max_length=128),
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    src: str | None = Query(default=None, max_length=512),
    event: str | None = Query(default=None, max_length=256),
    service: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    query = filtered_events(
        agent_id=agent_id,
        since=since,
        until=until,
        src=src,
        event=event,
        service=service,
    )
    rows = await session.execute(
        query.order_by(AgentEvent.ts.desc(), AgentEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [event_dict(item, external_id) for item, external_id in rows]


@router.get(
    "/stats",
    response_model=EventStats,
    dependencies=requires(PermissionName.EVENTS_READ),
)
async def event_stats(session: Session) -> EventStats:
    total = await session.scalar(select(func.count()).select_from(AgentEvent)) or 0
    by_event_rows = await session.execute(
        select(AgentEvent.event, func.count())
        .group_by(AgentEvent.event)
        .order_by(desc(func.count()))
        .limit(20)
    )
    by_service_rows = await session.execute(
        select(AgentEvent.service, func.count())
        .group_by(AgentEvent.service)
        .order_by(desc(func.count()))
        .limit(20)
    )
    source_rows = await session.execute(
        select(AgentEvent.src, func.count())
        .where(AgentEvent.src.is_not(None))
        .group_by(AgentEvent.src)
        .order_by(desc(func.count()))
        .limit(20)
    )
    geo = func.coalesce(
        AgentEvent.data["geo"].as_string(), AgentEvent.data["country"].as_string()
    )
    geo_rows = await session.execute(
        select(geo, func.count())
        .where(AgentEvent.data.is_not(None), geo.is_not(None))
        .group_by(geo)
        .order_by(desc(func.count()))
        .limit(50)
    )
    asn = AgentEvent.data["asn"].as_string()
    asn_rows = await session.execute(
        select(asn, func.count())
        .where(AgentEvent.data.is_not(None), asn.is_not(None))
        .group_by(asn)
        .order_by(desc(func.count()))
        .limit(50)
    )
    return EventStats(
        total=total,
        by_event={key: count for key, count in by_event_rows},
        by_service={key: count for key, count in by_service_rows},
        top_sources={key: count for key, count in source_rows},
        by_geo={key: count for key, count in geo_rows},
        by_asn={key: count for key, count in asn_rows},
        generated_at=datetime.now(UTC),
    )


def csv_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(("=", "+", "-", "@")) else text


@router.get(
    "/export.csv",
    dependencies=requires(PermissionName.EVENTS_READ),
    response_class=Response,
)
async def export_events_csv(session: Session) -> Response:
    rows = await session.execute(
        select(AgentEvent, Agent.external_id)
        .join(Agent)
        .order_by(AgentEvent.ts.desc())
        .limit(10_000)
    )
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(
        [
            "event_id",
            "agent_id",
            "timestamp",
            "service",
            "level",
            "source",
            "event",
            "rule",
            "geo",
            "asn",
            "protocol",
            "source_port",
            "destination_port",
            "username",
            "session_id",
            "data",
        ]
    )
    for item, agent_id in rows:
        data = item.data or {}
        writer.writerow(
            [
                item.event_id,
                csv_cell(agent_id),
                item.ts.isoformat(),
                csv_cell(item.service),
                csv_cell(item.level),
                csv_cell(item.src),
                csv_cell(item.event),
                csv_cell(item.rule),
                csv_cell(data.get("geo") or data.get("country")),
                csv_cell(data.get("asn")),
                csv_cell(data.get("protocol")),
                csv_cell(data.get("source_port") or data.get("src_port")),
                csv_cell(
                    data.get("destination_port") or data.get("dst_port")
                ),
                csv_cell(data.get("username")),
                csv_cell(data.get("session_id")),
                csv_cell(json.dumps(data, ensure_ascii=False, sort_keys=True)),
            ]
        )
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="events.csv"'},
    )


def source_ip(source: str | None) -> str | None:
    if not source:
        return None
    host = source
    if source.startswith("[") and "]" in source:
        host = source[1 : source.index("]")]
    elif source.count(":") == 1:
        host = source.rsplit(":", 1)[0]
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


@router.get(
    "/export.stix",
    dependencies=requires(PermissionName.EVENTS_READ),
)
async def export_events_stix(session: Session) -> dict[str, Any]:
    sources = await session.scalars(
        select(AgentEvent.src).where(AgentEvent.src.is_not(None)).distinct().limit(1000)
    )
    objects = []
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    for source in sources:
        ip = source_ip(source)
        if ip is None:
            continue
        kind = "ipv6-addr" if ":" in ip else "ipv4-addr"
        objects.append(
            {
                "type": "indicator",
                "spec_version": "2.1",
                "id": f"indicator--{uuid4()}",
                "created": now,
                "modified": now,
                "name": f"HoneyForge source {ip}",
                "pattern_type": "stix",
                "pattern": f"[{kind}:value = '{ip}']",
                "valid_from": now,
            }
        )
    return {
        "type": "bundle",
        "id": f"bundle--{uuid4()}",
        "objects": objects,
    }


@router.websocket("/ws")
async def event_stream(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    async with async_session() as session:
        user = await user_from_access_token(session, token)
        if user is None or PermissionName.EVENTS_READ not in user_permissions(user):
            await websocket.close(code=4403)
            return
        raw_cursor = websocket.query_params.get("cursor")
        if raw_cursor is None:
            cursor = await session.scalar(select(func.max(AgentEvent.id))) or 0
        elif raw_cursor.isdigit():
            cursor = int(raw_cursor)
        else:
            await websocket.close(code=4400)
            return
    await websocket.accept()
    try:
        while True:
            async with async_session() as session:
                rows = await session.execute(
                    select(AgentEvent, Agent.external_id)
                    .join(Agent)
                    .where(AgentEvent.id > cursor)
                    .order_by(AgentEvent.id)
                    .limit(100)
                )
                events = list(rows)
            for item, agent_id in events:
                cursor = item.id
                message = EventRead.model_validate(
                    event_dict(item, agent_id)
                ).model_dump(mode="json")
                await websocket.send_json(message, mode="text")
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return
