from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class SessionReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    started_at: AwareDatetime
    ended_at: AwareDatetime | None = None
    service: str = Field(min_length=1, max_length=256)
    level: Literal["low", "medium", "high"] | None = None
    src: str | None = Field(default=None, max_length=512)
    protocol: str | None = Field(default=None, min_length=1, max_length=32)
    source_port: int | None = Field(default=None, ge=1, le=65535)
    destination_port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=512)
    credentials: dict[str, Any] | None = Field(default=None, max_length=32)
    commands: list[str] = Field(default_factory=list, max_length=1000)
    requests: list[str] = Field(default_factory=list, max_length=1000)
    transcript: str | None = Field(default=None, max_length=1_048_576)
    data: dict[str, Any] = Field(default_factory=dict, max_length=128)

    @model_validator(mode="after")
    def valid_timeline(self) -> "SessionReport":
        if self.ended_at is not None and self.ended_at < self.started_at:
            raise ValueError("ended_at must not be before started_at")
        if any(len(item) > 4096 for item in self.commands + self.requests):
            raise ValueError("commands and requests are limited to 4096 characters")
        return self


class SessionBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessions: list[SessionReport] = Field(min_length=1, max_length=100)


class SessionRead(SessionReport):
    agent_id: str
    duration_ms: int | None


class CapturedArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_id: str
    session_id: UUID | None
    event_id: UUID | None
    uploaded_at: datetime
    kind: str
    file_name: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    data: dict[str, Any]


class HoneytokenTriggerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    honeytoken_id: int = Field(gt=0)
    triggered_at: AwareDatetime
    src: str | None = Field(default=None, max_length=512)
    context: dict[str, Any] = Field(default_factory=dict, max_length=128)


class HoneytokenTriggerRead(BaseModel):
    id: UUID
    honeytoken_id: int
    honeytoken_name: str
    agent_id: str
    triggered_at: datetime
    src: str | None
    context: dict[str, Any]
