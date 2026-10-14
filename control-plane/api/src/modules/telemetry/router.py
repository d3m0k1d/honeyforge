import json
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import PurePosixPath
from typing import Annotated, TypeAlias
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import (
    Agent,
    AgentConfiguration,
    AttackSession,
    CapturedArtifact,
    Honeytoken,
    HoneytokenTrigger,
)
from modules.agents.dependencies import GatewayAgent
from modules.auth.dependencies import requires
from modules.auth.schemas import PermissionName
from modules.telemetry.schemas import (
    CapturedArtifactRead,
    HoneytokenTriggerCreate,
    HoneytokenTriggerRead,
    SessionBatch,
    SessionRead,
)

router = APIRouter(tags=["telemetry"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]
MAX_CAPTURED_ARTIFACT_SIZE = 10 * 1024 * 1024


def aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def session_response(item: AttackSession, agent_id: str) -> SessionRead:
    started_at = aware(item.started_at)
    ended_at = aware(item.ended_at)
    duration_ms = None
    if started_at is not None and ended_at is not None:
        duration_ms = max(0, int((ended_at - started_at).total_seconds() * 1000))
    return SessionRead(
        id=item.session_id,
        agent_id=agent_id,
        started_at=started_at,
        ended_at=ended_at,
        service=item.service,
        level=item.level,
        src=item.src,
        protocol=item.protocol,
        source_port=item.source_port,
        destination_port=item.destination_port,
        username=item.username,
        credentials=item.credentials,
        commands=item.commands,
        requests=item.requests,
        transcript=item.transcript,
        data=item.data,
        duration_ms=duration_ms,
    )


@router.post("/agents/sessions")
async def ingest_sessions(
    payload: SessionBatch, agent: GatewayAgent, session: Session
) -> dict[str, int]:
    created = 0
    updated = 0
    for report in payload.sessions:
        item = await session.scalar(
            select(AttackSession).where(AttackSession.session_id == report.id)
        )
        if item is not None and item.agent_id != agent.id:
            raise HTTPException(409, "session ID belongs to another agent")
        values = report.model_dump(mode="json", exclude={"id"})
        values["started_at"] = report.started_at.astimezone(UTC)
        values["ended_at"] = (
            report.ended_at.astimezone(UTC) if report.ended_at is not None else None
        )
        if item is None:
            session.add(
                AttackSession(
                    agent_id=agent.id,
                    session_id=report.id,
                    **values,
                )
            )
            created += 1
        else:
            for key, value in values.items():
                setattr(item, key, value)
            updated += 1
    await session.commit()
    return {"accepted": len(payload.sessions), "created": created, "updated": updated}


@router.get(
    "/sessions",
    response_model=list[SessionRead],
    dependencies=requires(PermissionName.SESSIONS_READ),
)
async def list_sessions(
    session: Session,
    agent_id: str | None = Query(default=None, max_length=128),
    service: str | None = Query(default=None, max_length=256),
    src: str | None = Query(default=None, max_length=512),
    protocol: str | None = Query(default=None, max_length=32),
    username: str | None = Query(default=None, max_length=512),
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[SessionRead]:
    if any(value is not None and value.utcoffset() is None for value in (since, until)):
        raise HTTPException(422, "Time filters must include a timezone")
    if since is not None and until is not None and since > until:
        raise HTTPException(422, "since must not be after until")
    query = select(AttackSession, Agent.external_id).join(Agent)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    if service is not None:
        query = query.where(AttackSession.service == service)
    if src is not None:
        query = query.where(AttackSession.src == src)
    if protocol is not None:
        query = query.where(AttackSession.protocol == protocol)
    if username is not None:
        query = query.where(AttackSession.username == username)
    if since is not None:
        query = query.where(AttackSession.started_at >= since)
    if until is not None:
        query = query.where(AttackSession.started_at <= until)
    rows = await session.execute(
        query.order_by(AttackSession.started_at.desc(), AttackSession.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [session_response(item, external_id) for item, external_id in rows]


@router.get(
    "/sessions/{session_id}",
    response_model=SessionRead,
    dependencies=requires(PermissionName.SESSIONS_READ),
)
async def get_session(session_id: UUID, session: Session) -> SessionRead:
    row = (
        await session.execute(
            select(AttackSession, Agent.external_id)
            .join(Agent)
            .where(AttackSession.session_id == session_id)
        )
    ).first()
    if row is None:
        raise HTTPException(404, "Session not found")
    return session_response(row[0], row[1])


def artifact_response(item: CapturedArtifact, agent_id: str) -> CapturedArtifactRead:
    return CapturedArtifactRead(
        id=item.artifact_id,
        agent_id=agent_id,
        session_id=item.session_id,
        event_id=item.event_id,
        uploaded_at=aware(item.uploaded_at),
        kind=item.kind,
        file_name=item.file_name,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        checksum_sha256=item.checksum_sha256,
        data=item.data,
    )


@router.post(
    "/agents/artifacts",
    response_model=CapturedArtifactRead,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_artifact(
    agent: GatewayAgent,
    session: Session,
    artifact_id: Annotated[UUID, Form()],
    kind: Annotated[str, Form(min_length=1, max_length=32)],
    file: Annotated[UploadFile, File()],
    session_id: Annotated[UUID | None, Form()] = None,
    event_id: Annotated[UUID | None, Form()] = None,
    checksum_sha256: Annotated[str | None, Form(pattern=r"^[0-9a-f]{64}$")] = None,
    metadata: Annotated[str, Form(max_length=65_536)] = "{}",
) -> CapturedArtifactRead:
    file_name = file.filename or "artifact.bin"
    if (
        len(file_name) > 255
        or file_name in {".", ".."}
        or PurePosixPath(file_name).name != file_name
    ):
        raise HTTPException(422, "file name must not contain a path")
    try:
        data = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(422, "metadata must be valid JSON") from None
    if not isinstance(data, dict) or len(data) > 128:
        raise HTTPException(422, "metadata must be an object with at most 128 keys")
    content = await file.read(MAX_CAPTURED_ARTIFACT_SIZE + 1)
    if not content or len(content) > MAX_CAPTURED_ARTIFACT_SIZE:
        raise HTTPException(413, "artifact must be between 1 byte and 10 MiB")
    digest = sha256(content).hexdigest()
    if checksum_sha256 is not None and checksum_sha256 != digest:
        raise HTTPException(422, "artifact checksum mismatch")
    existing = await session.scalar(
        select(CapturedArtifact).where(CapturedArtifact.artifact_id == artifact_id)
    )
    if existing is not None:
        if existing.agent_id != agent.id:
            raise HTTPException(409, "artifact ID belongs to another agent")
        if existing.checksum_sha256 != digest:
            raise HTTPException(
                409, "artifact ID already exists with different content"
            )
        return artifact_response(existing, agent.external_id)
    item = CapturedArtifact(
        artifact_id=artifact_id,
        agent_id=agent.id,
        session_id=session_id,
        event_id=event_id,
        uploaded_at=datetime.now(UTC),
        kind=kind,
        file_name=file_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        checksum_sha256=digest,
        content=content,
        data=data,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return artifact_response(item, agent.external_id)


@router.get(
    "/artifacts",
    response_model=list[CapturedArtifactRead],
    dependencies=requires(PermissionName.ARTIFACTS_READ),
)
async def list_artifacts(
    session: Session,
    agent_id: str | None = Query(default=None, max_length=128),
    session_id: UUID | None = None,
    kind: str | None = Query(default=None, max_length=32),
    checksum_sha256: str | None = Query(default=None, pattern=r"^[0-9a-f]{64}$"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[CapturedArtifactRead]:
    query = select(CapturedArtifact, Agent.external_id).join(Agent)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    if session_id is not None:
        query = query.where(CapturedArtifact.session_id == session_id)
    if kind is not None:
        query = query.where(CapturedArtifact.kind == kind)
    if checksum_sha256 is not None:
        query = query.where(CapturedArtifact.checksum_sha256 == checksum_sha256)
    rows = await session.execute(
        query.order_by(CapturedArtifact.uploaded_at.desc(), CapturedArtifact.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [artifact_response(item, external_id) for item, external_id in rows]


async def load_artifact(
    session: AsyncSession, artifact_id: UUID
) -> tuple[CapturedArtifact, str]:
    row = (
        await session.execute(
            select(CapturedArtifact, Agent.external_id)
            .join(Agent)
            .where(CapturedArtifact.artifact_id == artifact_id)
        )
    ).first()
    if row is None:
        raise HTTPException(404, "Artifact not found")
    return row[0], row[1]


@router.get(
    "/artifacts/{artifact_id}",
    response_model=CapturedArtifactRead,
    dependencies=requires(PermissionName.ARTIFACTS_READ),
)
async def get_artifact(artifact_id: UUID, session: Session) -> CapturedArtifactRead:
    item, agent_id = await load_artifact(session, artifact_id)
    return artifact_response(item, agent_id)


@router.get(
    "/artifacts/{artifact_id}/content",
    response_class=Response,
    dependencies=requires(PermissionName.ARTIFACTS_READ),
)
async def download_artifact(artifact_id: UUID, session: Session) -> Response:
    item, _ = await load_artifact(session, artifact_id)
    return Response(
        content=item.content,
        media_type=item.content_type,
        headers={
            "Content-Disposition": (
                "attachment; filename*=UTF-8''" + quote(item.file_name, safe="")
            ),
            "X-Checksum-SHA256": item.checksum_sha256,
        },
    )


def trigger_response(
    item: HoneytokenTrigger, honeytoken_name: str, agent_id: str
) -> HoneytokenTriggerRead:
    return HoneytokenTriggerRead(
        id=item.trigger_id,
        honeytoken_id=item.honeytoken_id,
        honeytoken_name=honeytoken_name,
        agent_id=agent_id,
        triggered_at=aware(item.triggered_at),
        src=item.src,
        context=item.context,
    )


@router.post(
    "/agents/honeytoken-triggers",
    response_model=HoneytokenTriggerRead,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_honeytoken_trigger(
    payload: HoneytokenTriggerCreate, agent: GatewayAgent, session: Session
) -> HoneytokenTriggerRead:
    existing = await session.scalar(
        select(HoneytokenTrigger).where(HoneytokenTrigger.trigger_id == payload.id)
    )
    if existing is not None:
        if existing.agent_id != agent.id:
            raise HTTPException(409, "trigger ID belongs to another agent")
        if existing.honeytoken_id != payload.honeytoken_id:
            raise HTTPException(409, "trigger ID belongs to another honeytoken")
        honeytoken_name = await session.scalar(
            select(Honeytoken.name).where(Honeytoken.id == existing.honeytoken_id)
        )
        if honeytoken_name is None:
            raise HTTPException(409, "trigger references a missing honeytoken")
        return trigger_response(existing, honeytoken_name, agent.external_id)

    configuration = await session.get(AgentConfiguration, agent.id)
    assigned = {
        item.get("id")
        for item in (
            configuration.config.get("honeytokens", []) if configuration else []
        )
        if isinstance(item, dict)
    }
    if payload.honeytoken_id not in assigned:
        raise HTTPException(404, "Assigned honeytoken not found")
    honeytoken = await session.scalar(
        select(Honeytoken).where(
            Honeytoken.id == payload.honeytoken_id,
            Honeytoken.is_active.is_(True),
        )
    )
    if honeytoken is None:
        raise HTTPException(404, "Assigned honeytoken not found")
    item = HoneytokenTrigger(
        trigger_id=payload.id,
        honeytoken_id=payload.honeytoken_id,
        agent_id=agent.id,
        triggered_at=payload.triggered_at.astimezone(UTC),
        src=payload.src,
        context=payload.context,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return trigger_response(item, honeytoken.name, agent.external_id)


@router.get(
    "/honeytoken-triggers",
    response_model=list[HoneytokenTriggerRead],
    dependencies=requires(PermissionName.HONEYTOKENS_READ),
)
async def list_honeytoken_triggers(
    session: Session,
    honeytoken_id: int | None = Query(default=None, gt=0),
    agent_id: str | None = Query(default=None, max_length=128),
    since: Annotated[datetime | None, Query()] = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[HoneytokenTriggerRead]:
    if since is not None and since.utcoffset() is None:
        raise HTTPException(422, "since must include a timezone")
    query = (
        select(HoneytokenTrigger, Honeytoken.name, Agent.external_id)
        .join(Honeytoken)
        .join(Agent)
    )
    if honeytoken_id is not None:
        query = query.where(HoneytokenTrigger.honeytoken_id == honeytoken_id)
    if agent_id is not None:
        query = query.where(Agent.external_id == agent_id)
    if since is not None:
        query = query.where(HoneytokenTrigger.triggered_at >= since)
    rows = await session.execute(
        query.order_by(HoneytokenTrigger.triggered_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [
        trigger_response(item, name, external_id)
        for item, name, external_id in rows
    ]
