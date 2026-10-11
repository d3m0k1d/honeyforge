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
    Header,
    HTTPException,
    Path,
    Response,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from db.engine import get_session
from db.models import Agent
from modules.agents.schemas import (
    AGENT_ID_PATTERN,
    AgentEnroll,
    AgentHeartbeatRead,
    EnrollmentTokenCreate,
    EnrollmentTokenRead,
)
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName

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
    gateway_token: Annotated[str | None, Header(alias="X-Agent-Gateway-Token")] = None,
    certificate_verified: Annotated[
        str | None, Header(alias="X-Agent-Certificate-Verified")
    ] = None,
    certificate_subject: Annotated[
        str | None, Header(alias="X-Agent-Certificate-Subject")
    ] = None,
) -> AgentHeartbeatRead:
    expected_token = Settings.AGENT_GATEWAY_TOKEN
    if (
        expected_token is None
        or gateway_token is None
        or not secrets.compare_digest(gateway_token, expected_token)
        or certificate_verified != "SUCCESS"
        or certificate_subject is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid client certificate required",
        )

    common_names = [
        part[3:] for part in certificate_subject.split(",") if part.startswith("CN=")
    ]
    if len(common_names) != 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid client certificate required",
        )

    agent = await session.scalar(
        select(Agent).where(
            Agent.external_id == common_names[0],
            Agent.enrolled_at.is_not(None),
        )
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown agent certificate",
        )

    agent.last_heartbeat_at = datetime.now(UTC)
    await session.commit()
    return AgentHeartbeatRead(
        agent_id=agent.external_id,
        last_heartbeat_at=agent.last_heartbeat_at,
    )
