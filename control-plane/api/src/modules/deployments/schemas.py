from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ArtifactKind(StrEnum):
    SHELL = "shell"
    ANSIBLE = "ansible"


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: ArtifactKind
    entrypoint: str
    size_bytes: int
    checksum_sha256: str
    created_at: datetime


class DeploymentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    agent_id: str = Field(min_length=1, max_length=128)
    honeypot_type: str = Field(min_length=1, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)


class DeploymentRead(BaseModel):
    id: UUID
    name: str
    agent_id: str
    honeypot_type: str
    definition_version: int
    level: str
    driver: str
    config: dict[str, Any]
    desired_state: str
    observed_state: str
    generation: int
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class DeploymentAction(StrEnum):
    START = "start"
    STOP = "stop"
    DESTROY = "destroy"
    RECONCILE = "reconcile"
    UPDATE = "update"
    ROTATE_CREDENTIALS = "rotate_credentials"


class DeploymentActionRequest(BaseModel):
    action: DeploymentAction
    parameters: dict[str, Any] = Field(default_factory=dict, max_length=64)


class SnapshotCreate(BaseModel):
    type: str = Field(default="manual", pattern=r"^(manual|clean|incident)$")


class ResetRequest(BaseModel):
    preserve_incident: bool = True


class SnapshotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    deployment_id: UUID
    type: str
    state: str
    path: str | None
    size_bytes: int | None
    checksum_sha256: str | None
    error: str | None
    created_at: datetime
    ready_at: datetime | None


class CommandStatus(StrEnum):
    QUEUED = "queued"
    LEASED = "leased"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CommandRead(BaseModel):
    id: UUID
    deployment_id: UUID
    type: str
    payload: dict[str, Any]
    status: CommandStatus
    generation: int
    attempts: int
    lease_until: datetime | None
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime


class CommandClaim(BaseModel):
    lease_seconds: int = Field(default=60, ge=10, le=600)


class CommandResult(BaseModel):
    status: CommandStatus
    result: dict[str, Any] | None = None
    error: str | None = Field(default=None, max_length=10_000)
    snapshot_path: str | None = Field(default=None, max_length=1024)
    snapshot_size_bytes: int | None = Field(default=None, ge=0)
    snapshot_checksum_sha256: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{64}$"
    )
