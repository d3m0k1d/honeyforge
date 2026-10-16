from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    method: str
    path: str
    status_code: int
    client_ip: str | None
    user_agent: str | None
    created_at: datetime
