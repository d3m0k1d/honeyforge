import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from io import BytesIO
from pathlib import Path as FilePath
from typing import Annotated, TypeAlias
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import Settings
from db.engine import get_session
from db.models import Agent, AgentConfiguration, AgentEvent
from modules.agents.dependencies import GatewayAgent
from modules.agents.schemas import (
    AGENT_ID_PATTERN,
    AgentConfigRead,
    AgentConfigWrite,
    AgentEnroll,
    AgentEventBatch,
    AgentEventRead,
    AgentHeartbeatRead,
    AgentRead,
    EnrollmentTokenCreate,
    EnrollmentTokenRead,
)
from modules.alerts.service import evaluate_alerts
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName
from modules.telemetry.enrichment import enrich

router = APIRouter(prefix="/agents", tags=["agents"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]
CERTIFICATE_FILES = ("ca.crt", "client.crt", "client.key", "fullchain.crt")


def certificate_directory(agent_id: str) -> FilePath:
    return Settings.MTLS_DIR / "clients" / agent_id


def build_certificate_bundle(agent_id: str) -> bytes:
    directory = certificate_directory(agent_id)
    if not directory.is_dir():
        raise FileNotFoundError(agent_id)

    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for file_name in CERTIFICATE_FILES:
            path = directory / file_name
            if not path.is_file():
                raise FileNotFoundError(path)
            archive.write(path, arcname=file_name)
    return output.getvalue()


def bundle_response(
    agent_id: str, content: bytes, status_code: int = status.HTTP_200_OK
) -> Response:
    return Response(
        content=content,
        status_code=status_code,
        media_type="application/zip",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": (
                f'attachment; filename="{agent_id}-mtls-certificate.zip"'
            ),
        },
    )


async def issue_certificate(agent_id: str) -> None:
    process = await asyncio.create_subprocess_exec(
        "issue-mtls-cert",
        agent_id,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        async with asyncio.timeout(60):
            _, stderr = await process.communicate()
    except TimeoutError:
        process.kill()
        await process.wait()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Certificate issuer timed out",
        ) from None

    if process.returncode != 0:
        message = stderr.decode(errors="replace")
        if "certificate store is busy" in message:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Certificate issuer is busy",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not issue agent certificate",
        )


@router.post(
    "/enrollment-tokens",
    response_model=EnrollmentTokenRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.AGENTS_MANAGE),
)
async def create_enrollment_token(
    payload: EnrollmentTokenCreate,
    user: CurrentUser,
    session: Session,
) -> EnrollmentTokenRead:
    agent = await session.scalar(
        select(Agent).where(Agent.external_id == payload.agent_id)
    )
    if agent is not None and agent.enrolled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agent is already enrolled",
        )
    if certificate_directory(payload.agent_id).exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agent certificate already exists",
        )

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(minutes=payload.expires_in_minutes)
    if agent is None:
        agent = Agent(external_id=payload.agent_id, created_by_id=user.id)
        session.add(agent)
    agent.enrollment_token_hash = sha256(token.encode()).hexdigest()
    agent.enrollment_expires_at = expires_at

    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create enrollment token",
        ) from None

    return EnrollmentTokenRead(
        agent_id=payload.agent_id,
        token=token,
        expires_at=expires_at,
    )


@router.post(
    "/enroll",
    status_code=status.HTTP_201_CREATED,
    response_class=Response,
)
async def enroll_agent(payload: AgentEnroll, session: Session) -> Response:
    token_hash = sha256(payload.token.encode()).hexdigest()
    agent = await session.scalar(
        select(Agent).where(Agent.enrollment_token_hash == token_hash).with_for_update()
    )
    now = datetime.now(UTC)
    if (
        agent is None
        or agent.enrollment_expires_at is None
        or agent.enrollment_expires_at <= now
        or agent.enrolled_at is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired enrollment token",
        )

    if certificate_directory(agent.external_id).exists():
        content = await asyncio.to_thread(build_certificate_bundle, agent.external_id)
    else:
        await issue_certificate(agent.external_id)
        content = await asyncio.to_thread(build_certificate_bundle, agent.external_id)

    agent.enrollment_token_hash = None
    agent.enrollment_expires_at = None
    agent.enrolled_at = now
    await session.commit()
    return bundle_response(agent.external_id, content, status.HTTP_201_CREATED)


@router.get(
    "/{agent_id}/certificate",
    dependencies=requires(PermissionName.AGENTS_MANAGE),
    response_class=Response,
)
async def download_agent_certificate(
    agent_id: str = Path(pattern=AGENT_ID_PATTERN),
) -> Response:
    try:
        content = await asyncio.to_thread(build_certificate_bundle, agent_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent certificate not found",
        ) from None
    return bundle_response(agent_id, content)


@router.post("/heartbeat", response_model=AgentHeartbeatRead)
async def agent_heartbeat(
    session: Session,
    agent: GatewayAgent,
) -> AgentHeartbeatRead:
    agent.last_heartbeat_at = datetime.now(UTC)
    await session.commit()
    return AgentHeartbeatRead(
        agent_id=agent.external_id,
        last_heartbeat_at=agent.last_heartbeat_at,
    )


@router.get(
    "/config", response_model=AgentConfigRead, response_model_exclude_unset=True
)
async def agent_config(session: Session, agent: GatewayAgent) -> dict:
    configuration = await session.get(AgentConfiguration, agent.id)
    if configuration is None:
        raise HTTPException(404, "Agent configuration not assigned")
    return {**configuration.config, "version": configuration.version}


@router.put(
    "/{agent_id}/config",
    response_model=AgentConfigRead,
    response_model_exclude_unset=True,
    dependencies=requires(PermissionName.AGENTS_MANAGE),
)
async def assign_agent_config(
    payload: AgentConfigWrite,
    session: Session,
    agent_id: str = Path(pattern=AGENT_ID_PATTERN),
) -> dict:
    agent = await session.scalar(
        select(Agent).where(Agent.external_id == agent_id).with_for_update()
    )
    if agent is None:
        raise HTTPException(404, "Agent not found")
    configuration = await session.get(AgentConfiguration, agent.id)
    config = payload.model_dump(mode="json", exclude_unset=True, exclude={"version"})
    config.setdefault("log", {})
    if configuration is None:
        configuration = AgentConfiguration(agent_id=agent.id, version=1, config=config)
        session.add(configuration)
    else:
        configuration.profile_id = None
        configuration.version += 1
        configuration.config = config
    await session.commit()
    return {**config, "version": configuration.version}


@router.post("/events")
async def ingest_agent_events(
    payload: AgentEventBatch, session: Session, agent: GatewayAgent
) -> dict[str, int]:
    rows = []
    for event in payload.events:
        row = event.model_dump()
        row["event_id"] = row.pop("id")
        row["ts"] = event.ts.astimezone(UTC)
        row["data"] = await enrich(event.src, row.get("data") or {})
        rows.append({**row, "agent_id": agent.id})
    insert_factory = sqlite_insert if session.bind.dialect.name == "sqlite" else insert
    await session.execute(
        insert_factory(AgentEvent)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["agent_id", "event_id"])
    )
    await evaluate_alerts(
        session,
        agent.id,
        {(event.event, event.service) for event in payload.events},
    )
    await session.commit()
    return {"accepted": len(payload.events)}


@router.get(
    "/{agent_id}/events",
    response_model=list[AgentEventRead],
    response_model_exclude_none=True,
    dependencies=requires(PermissionName.EVENTS_READ),
)
async def list_agent_events(
    session: Session,
    agent_id: str = Path(pattern=AGENT_ID_PATTERN),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    src: str | None = Query(default=None, max_length=512),
    event: str | None = Query(default=None, max_length=256),
) -> list[dict]:
    if any(value is not None and value.utcoffset() is None for value in (since, until)):
        raise HTTPException(422, "Time filters must include a timezone")
    if since is not None and until is not None and since > until:
        raise HTTPException(422, "since must not be after until")
    agent = await session.scalar(select(Agent).where(Agent.external_id == agent_id))
    if agent is None:
        raise HTTPException(404, "Agent not found")
    query = select(AgentEvent).where(AgentEvent.agent_id == agent.id)
    if since is not None:
        query = query.where(AgentEvent.ts >= since)
    if until is not None:
        query = query.where(AgentEvent.ts <= until)
    if src is not None:
        query = query.where(AgentEvent.src == src)
    if event is not None:
        query = query.where(AgentEvent.event == event)
    rows = await session.scalars(
        query.order_by(AgentEvent.ts.desc(), AgentEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [
        {
            "id": row.event_id,
            "ts": row.ts.replace(tzinfo=UTC) if row.ts.tzinfo is None else row.ts,
            "service": row.service,
            "level": row.level,
            "src": row.src,
            "event": row.event,
            "rule": row.rule,
            "data": row.data,
        }
        for row in rows
    ]


@router.get(
    "",
    response_model=list[AgentRead],
    dependencies=requires(PermissionName.AGENTS_READ),
)
async def list_agents(session: Session) -> list[AgentRead]:
    agents = await session.scalars(
        select(Agent)
        .options(
            selectinload(Agent.configuration).selectinload(AgentConfiguration.profile)
        )
        .order_by(Agent.id)
    )
    threshold = datetime.now(UTC) - timedelta(seconds=60)
    result = []
    for agent in agents:
        heartbeat = agent.last_heartbeat_at
        if heartbeat is not None and heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=UTC)
        result.append(
            AgentRead(
                agent_id=agent.external_id,
                created_at=agent.created_at,
                enrolled_at=agent.enrolled_at,
                last_heartbeat_at=heartbeat,
                online=(
                    agent.enrolled_at is not None
                    and heartbeat is not None
                    and heartbeat >= threshold
                ),
                profile_id=(
                    agent.configuration.profile_id if agent.configuration else None
                ),
                profile_name=(
                    agent.configuration.profile.name
                    if agent.configuration and agent.configuration.profile
                    else None
                ),
            )
        )
    return result


@router.post(
    "/{agent_id}/revoke",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.AGENTS_MANAGE),
)
async def revoke_agent(
    session: Session,
    agent_id: str = Path(pattern=AGENT_ID_PATTERN),
) -> Response:
    agent = await session.scalar(
        select(Agent).where(Agent.external_id == agent_id).with_for_update()
    )
    if agent is None:
        raise HTTPException(404, "Agent not found")
    agent.enrolled_at = None
    agent.enrollment_token_hash = None
    agent.enrollment_expires_at = None
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
