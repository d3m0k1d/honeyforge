from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import AwareDatetime, BaseModel


class EventRead(BaseModel):
    id: int
    event_id: UUID
    agent_id: str
    ts: AwareDatetime
    service: str
    level: str | None
    src: str | None
    event: str
    rule: str | None
    data: dict[str, Any] | None
    geo: str | None = None
    asn: str | None = None
    protocol: str | None = None
    source_port: int | None = None
    destination_port: int | None = None
    username: str | None = None
    command: str | None = None
    request: str | None = None
    payload: str | None = None
    session_id: UUID | None = None


class EventStats(BaseModel):
    total: int
    by_event: dict[str, int]
    by_service: dict[str, int]
    top_sources: dict[str, int]
    by_geo: dict[str, int]
    by_asn: dict[str, int]
    generated_at: datetime
