from datetime import datetime

from pydantic import BaseModel, Field

AGENT_ID_PATTERN = r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$"


class EnrollmentTokenCreate(BaseModel):
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    expires_in_minutes: int = Field(default=15, ge=1, le=1440)


class EnrollmentTokenRead(BaseModel):
    agent_id: str
    token: str
    expires_at: datetime


class AgentEnroll(BaseModel):
    token: str = Field(min_length=32, max_length=256)


class AgentHeartbeatRead(BaseModel):
    agent_id: str
    last_heartbeat_at: datetime
