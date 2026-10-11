from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import PurePosixPath
from typing import Annotated, TypeAlias
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
from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from db.engine import get_session
from db.models import (
    Agent,
    Deployment,
    DeploymentArtifact,
    DeploymentCommand,
    DeploymentSnapshot,
)
from modules.agents.dependencies import GatewayAgent
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName
from modules.deployments.catalog import DEFINITIONS, HighConfig, validate_config
from modules.deployments.schemas import (
    ArtifactKind,
    ArtifactRead,
    CommandClaim,
    CommandRead,
    CommandResult,
    CommandStatus,
    DeploymentAction,
    DeploymentActionRequest,
    DeploymentCreate,
    DeploymentRead,
    ResetRequest,
    SnapshotCreate,
    SnapshotRead,
)

router = APIRouter(tags=["deployments"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]
MAX_ARTIFACT_SIZE = 10 * 1024 * 1024


def deployment_response(deployment: Deployment) -> DeploymentRead:
    return DeploymentRead(
        id=deployment.id,
        name=deployment.name,
        agent_id=deployment.agent.external_id,
        honeypot_type=deployment.honeypot_type,
        definition_version=deployment.definition_version,
        level=deployment.level,
        driver=deployment.driver,
        config=deployment.config,
        desired_state=deployment.desired_state,
        observed_state=deployment.observed_state,
        generation=deployment.generation,
        last_error=deployment.last_error,
        created_at=deployment.created_at,
        updated_at=deployment.updated_at,
    )


def command_response(command: DeploymentCommand) -> CommandRead:
    return CommandRead(
        id=command.id,
        deployment_id=command.deployment_id,
        type=command.type,
        payload=command.payload,
        status=command.status,
        generation=command.generation,
        attempts=command.attempts,
        lease_until=command.lease_until,
        result=command.result,
        error=command.error,
        created_at=command.created_at,
    )


async def load_deployment(session: AsyncSession, deployment_id: UUID) -> Deployment:
    deployment = await session.scalar(
        select(Deployment)
        .where(Deployment.id == deployment_id)
        .options(selectinload(Deployment.agent))
    )
    if deployment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deployment not found",
        )
    return deployment


def deployment_payload(deployment: Deployment) -> dict:
    return {
        "deployment_id": str(deployment.id),
        "generation": deployment.generation,
        "honeypot_type": deployment.honeypot_type,
        "definition_version": deployment.definition_version,
        "level": deployment.level,
        "driver": deployment.driver,
        "config": deployment.config,
    }


def enqueue_command(
    session: AsyncSession,
    deployment: Deployment,
    command_type: str,
    extra: dict | None = None,
) -> DeploymentCommand:
    payload = deployment_payload(deployment)
    if extra:
        payload.update(extra)
    command = DeploymentCommand(
        deployment_id=deployment.id,
        agent_id=deployment.agent_id,
        type=command_type,
        payload=payload,
        generation=deployment.generation,
    )
    session.add(command)
    return command


@router.get(
    "/honeypot-types",
    dependencies=requires(PermissionName.DEPLOYMENTS_READ),
)
async def list_honeypot_types() -> list[dict]:
    return list(DEFINITIONS.values())


@router.post(
    "/deployment-artifacts",
    response_model=ArtifactRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
)
async def upload_deployment_artifact(
    user: CurrentUser,
    session: Session,
    kind: Annotated[ArtifactKind, Form()],
    entrypoint: Annotated[str, Form(min_length=1, max_length=255)],
    file: Annotated[UploadFile, File()],
) -> DeploymentArtifact:
    entrypoint_path = PurePosixPath(entrypoint)
    if entrypoint_path.is_absolute() or ".." in entrypoint_path.parts:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Entrypoint must be a relative path without '..'",
        )
    content = await file.read(MAX_ARTIFACT_SIZE + 1)
    if not content or len(content) > MAX_ARTIFACT_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Artifact must be between 1 byte and 10 MiB",
        )
    artifact = DeploymentArtifact(
        name=file.filename or entrypoint_path.name,
        kind=kind,
        entrypoint=entrypoint,
        content=content,
        size_bytes=len(content),
        checksum_sha256=sha256(content).hexdigest(),
        created_by_id=user.id,
    )
    session.add(artifact)
    await session.commit()
    await session.refresh(artifact)
    return artifact


@router.get(
    "/deployment-artifacts/{artifact_id}",
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
    response_class=Response,
)
async def download_deployment_artifact(artifact_id: UUID, session: Session) -> Response:
    artifact = await session.get(DeploymentArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return Response(
        content=artifact.content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{artifact.name}"',
            "X-Checksum-SHA256": artifact.checksum_sha256,
        },
    )


@router.post(
    "/deployments",
    response_model=DeploymentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
)
async def create_deployment(
    payload: DeploymentCreate,
    user: CurrentUser,
    session: Session,
) -> DeploymentRead:
    definition = DEFINITIONS.get(payload.honeypot_type)
    if definition is None:
        raise HTTPException(status_code=422, detail="Unknown honeypot type")
    config = validate_config(definition, payload.config)
    agent = await session.scalar(
        select(Agent).where(
            Agent.external_id == payload.agent_id,
            Agent.enrolled_at.is_not(None),
        )
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Enrolled agent not found")

    if definition["level"] == "high":
        high_config = HighConfig.model_validate(config)
        if high_config.provisioning_artifact_id is not None:
            try:
                artifact_id = UUID(high_config.provisioning_artifact_id)
            except ValueError:
                raise HTTPException(
                    status_code=422, detail="Invalid provisioning artifact ID"
                ) from None
            if await session.get(DeploymentArtifact, artifact_id) is None:
                raise HTTPException(status_code=404, detail="Artifact not found")

    deployment = Deployment(
        name=payload.name,
        agent_id=agent.id,
        created_by_id=user.id,
        honeypot_type=definition["slug"],
        definition_version=definition["version"],
        level=definition["level"],
        driver=definition["driver"],
        config=config,
    )
    session.add(deployment)
    await session.flush()
    deployment.agent = agent
    enqueue_command(
        session,
        deployment,
        "deploy",
        {"create_clean_snapshot": deployment.level == "high"},
    )
    await session.commit()
    await session.refresh(deployment)
    deployment.agent = agent
    return deployment_response(deployment)


@router.get(
    "/deployments",
    response_model=list[DeploymentRead],
    dependencies=requires(PermissionName.DEPLOYMENTS_READ),
)
async def list_deployments(
    session: Session,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[DeploymentRead]:
    deployments = (
        await session.scalars(
            select(Deployment)
            .options(selectinload(Deployment.agent))
            .order_by(Deployment.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return [deployment_response(item) for item in deployments]


@router.get(
    "/deployments/{deployment_id}",
    response_model=DeploymentRead,
    dependencies=requires(PermissionName.DEPLOYMENTS_READ),
)
async def get_deployment(deployment_id: UUID, session: Session) -> DeploymentRead:
    return deployment_response(await load_deployment(session, deployment_id))


@router.post(
    "/deployments/{deployment_id}/actions",
    response_model=DeploymentRead,
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
)
async def deployment_action(
    deployment_id: UUID,
    payload: DeploymentActionRequest,
    session: Session,
) -> DeploymentRead:
    deployment = await load_deployment(session, deployment_id)
    if deployment.desired_state == "deleted":
        raise HTTPException(status_code=409, detail="Deployment is deleted")

    now = datetime.now(UTC)
    await session.execute(
        update(DeploymentCommand)
        .where(
            DeploymentCommand.deployment_id == deployment.id,
            DeploymentCommand.status == CommandStatus.QUEUED,
        )
        .values(status=CommandStatus.CANCELLED, finished_at=now)
    )
    deployment.generation += 1
    desired_states = {
        DeploymentAction.START: "running",
        DeploymentAction.STOP: "stopped",
        DeploymentAction.DESTROY: "deleted",
    }
    if payload.action in desired_states:
        deployment.desired_state = desired_states[payload.action]
    enqueue_command(session, deployment, payload.action)
    await session.commit()
    await session.refresh(deployment)
    return deployment_response(deployment)


@router.post(
    "/deployments/{deployment_id}/snapshots",
    response_model=SnapshotRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
)
async def create_snapshot(
    deployment_id: UUID,
    payload: SnapshotCreate,
    session: Session,
) -> DeploymentSnapshot:
    deployment = await load_deployment(session, deployment_id)
    if deployment.level != "high":
        raise HTTPException(status_code=409, detail="Snapshots require high level")
    snapshot = DeploymentSnapshot(deployment_id=deployment.id, type=payload.type)
    session.add(snapshot)
    await session.flush()
    deployment.generation += 1
    enqueue_command(
        session,
        deployment,
        "vm.snapshot",
        {"snapshot_id": str(snapshot.id), "snapshot_type": snapshot.type},
    )
    await session.commit()
    await session.refresh(snapshot)
    return snapshot


@router.post(
    "/deployments/{deployment_id}/reset",
    response_model=DeploymentRead,
    dependencies=requires(PermissionName.DEPLOYMENTS_MANAGE),
)
async def reset_deployment(
    deployment_id: UUID,
    payload: ResetRequest,
    session: Session,
) -> DeploymentRead:
    deployment = await load_deployment(session, deployment_id)
    if deployment.level != "high":
        raise HTTPException(status_code=409, detail="Reset requires high level")
    deployment.generation += 1
    snapshot_id = None
    if payload.preserve_incident:
        snapshot = DeploymentSnapshot(deployment_id=deployment.id, type="incident")
        session.add(snapshot)
        await session.flush()
        snapshot_id = str(snapshot.id)
    enqueue_command(
        session,
        deployment,
        "vm.reset",
        {"preserve_incident": payload.preserve_incident, "snapshot_id": snapshot_id},
    )
    await session.commit()
    await session.refresh(deployment)
    return deployment_response(deployment)


@router.get(
    "/deployments/{deployment_id}/commands",
    response_model=list[CommandRead],
    dependencies=requires(PermissionName.DEPLOYMENTS_READ),
)
async def list_commands(deployment_id: UUID, session: Session) -> list[CommandRead]:
    await load_deployment(session, deployment_id)
    commands = (
        await session.scalars(
            select(DeploymentCommand)
            .where(DeploymentCommand.deployment_id == deployment_id)
            .order_by(DeploymentCommand.created_at)
        )
    ).all()
    return [command_response(item) for item in commands]


@router.get(
    "/deployments/{deployment_id}/snapshots",
    response_model=list[SnapshotRead],
    dependencies=requires(PermissionName.DEPLOYMENTS_READ),
)
async def list_snapshots(
    deployment_id: UUID, session: Session
) -> list[DeploymentSnapshot]:
    await load_deployment(session, deployment_id)
    return list(
        await session.scalars(
            select(DeploymentSnapshot)
            .where(DeploymentSnapshot.deployment_id == deployment_id)
            .order_by(DeploymentSnapshot.created_at.desc())
        )
    )


@router.post(
    "/agents/commands/claim",
    response_model=CommandRead,
    responses={204: {"description": "No queued commands"}},
)
async def claim_command(
    payload: CommandClaim,
    agent: GatewayAgent,
    session: Session,
) -> CommandRead | Response:
    now = datetime.now(UTC)
    earlier_command = aliased(DeploymentCommand)
    command = await session.scalar(
        select(DeploymentCommand)
        .where(
            DeploymentCommand.agent_id == agent.id,
            or_(
                DeploymentCommand.status == CommandStatus.QUEUED,
                (
                    DeploymentCommand.status.in_(
                        [CommandStatus.LEASED, CommandStatus.RUNNING]
                    )
                    & (DeploymentCommand.lease_until < now)
                ),
            ),
            ~exists(
                select(earlier_command.id).where(
                    earlier_command.deployment_id == DeploymentCommand.deployment_id,
                    earlier_command.status.in_(
                        [
                            CommandStatus.QUEUED,
                            CommandStatus.LEASED,
                            CommandStatus.RUNNING,
                        ]
                    ),
                    or_(
                        earlier_command.created_at < DeploymentCommand.created_at,
                        and_(
                            earlier_command.created_at == DeploymentCommand.created_at,
                            earlier_command.id < DeploymentCommand.id,
                        ),
                    ),
                )
            ),
        )
        .order_by(DeploymentCommand.created_at, DeploymentCommand.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if command is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    command.status = CommandStatus.LEASED
    command.lease_until = now + timedelta(seconds=payload.lease_seconds)
    command.attempts += 1
    command.started_at = command.started_at or now
    await session.commit()
    await session.refresh(command)
    return command_response(command)


@router.post(
    "/agents/commands/{command_id}/result",
    response_model=CommandRead,
)
async def report_command_result(
    command_id: UUID,
    payload: CommandResult,
    agent: GatewayAgent,
    session: Session,
) -> CommandRead:
    if payload.status not in {
        CommandStatus.RUNNING,
        CommandStatus.SUCCEEDED,
        CommandStatus.FAILED,
    }:
        raise HTTPException(status_code=422, detail="Invalid result status")
    command = await session.scalar(
        select(DeploymentCommand)
        .where(
            DeploymentCommand.id == command_id,
            DeploymentCommand.agent_id == agent.id,
        )
        .options(selectinload(DeploymentCommand.deployment))
        .with_for_update()
    )
    if command is None:
        raise HTTPException(status_code=404, detail="Command not found")
    if command.status not in {CommandStatus.LEASED, CommandStatus.RUNNING}:
        raise HTTPException(status_code=409, detail="Command is not leased")

    now = datetime.now(UTC)
    command.status = payload.status
    command.result = payload.result
    command.error = payload.error
    if payload.status == CommandStatus.RUNNING:
        command.lease_until = now + timedelta(seconds=60)
    else:
        command.lease_until = None
        command.finished_at = now

    deployment = command.deployment
    if command.generation == deployment.generation:
        if payload.status == CommandStatus.FAILED:
            deployment.observed_state = "error"
            deployment.last_error = payload.error or "Command failed"
        elif payload.status == CommandStatus.SUCCEEDED:
            states = {
                "deploy": "running",
                "start": "running",
                "stop": "stopped",
                "destroy": "deleted",
                "vm.reset": "running",
            }
            if command.type in states:
                deployment.observed_state = states[command.type]
                deployment.last_error = None

    snapshot_id = command.payload.get("snapshot_id")
    if snapshot_id and payload.status in {
        CommandStatus.SUCCEEDED,
        CommandStatus.FAILED,
    }:
        snapshot = await session.get(DeploymentSnapshot, UUID(snapshot_id))
        if snapshot is not None:
            snapshot.state = (
                "ready" if payload.status == CommandStatus.SUCCEEDED else "failed"
            )
            snapshot.path = payload.snapshot_path
            snapshot.size_bytes = payload.snapshot_size_bytes
            snapshot.checksum_sha256 = payload.snapshot_checksum_sha256
            snapshot.error = payload.error
            snapshot.ready_at = (
                now if payload.status == CommandStatus.SUCCEEDED else None
            )

    await session.commit()
    await session.refresh(command)
    return command_response(command)


@router.get(
    "/agents/commands/{command_id}/artifacts/{artifact_id}",
    response_class=Response,
)
async def download_command_artifact(
    command_id: UUID,
    artifact_id: UUID,
    agent: GatewayAgent,
    session: Session,
) -> Response:
    command = await session.scalar(
        select(DeploymentCommand).where(
            DeploymentCommand.id == command_id,
            DeploymentCommand.agent_id == agent.id,
            DeploymentCommand.status.in_([CommandStatus.LEASED, CommandStatus.RUNNING]),
        )
    )
    if (
        command is None
        or command.type != "deploy"
        or command.payload.get("config", {}).get("provisioning_artifact_id")
        != str(artifact_id)
    ):
        raise HTTPException(status_code=404, detail="Artifact not found")
    artifact = await session.get(DeploymentArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return Response(
        content=artifact.content,
        media_type="application/octet-stream",
        headers={"X-Checksum-SHA256": artifact.checksum_sha256},
    )
