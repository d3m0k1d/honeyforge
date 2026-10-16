from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from modules.agents.schemas import AgentLog, AgentMasking, AgentService


class ProfileBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    level: Literal["low", "medium"]
    services: list[AgentService] = Field(min_length=1, max_length=64)
    logging: AgentLog = Field(default_factory=AgentLog)
    masking: AgentMasking = Field(default_factory=AgentMasking)
    honeytoken_ids: list[int] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_service_levels(self) -> "ProfileBase":
        if self.level == "low" and any(
            service.level not in ("", "low") for service in self.services
        ):
            raise ValueError("low profile cannot contain medium services")
        if len(set(self.honeytoken_ids)) != len(self.honeytoken_ids):
            raise ValueError("honeytoken_ids must be unique")
        return self


class ProfileCreate(ProfileBase):
    pass


class ProfileUpdate(ProfileBase):
    pass


class ProfileRead(ProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_id: int | None
    created_at: datetime
    updated_at: datetime
