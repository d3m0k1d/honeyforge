from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AlertRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    event: str = Field(min_length=1, max_length=256)
    service: str | None = Field(default=None, max_length=256)
    threshold: int = Field(ge=1, le=100_000)
    window_seconds: int = Field(default=60, ge=1, le=86_400)


class AlertRuleRead(AlertRuleCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_id: int | None
    created_at: datetime


class AlertRead(BaseModel):
    id: UUID
    rule_id: UUID
    rule_name: str
    agent_id: str
    source: str | None
    event_count: int
    triggered_at: datetime
    acknowledged: bool
    acknowledged_at: datetime | None
