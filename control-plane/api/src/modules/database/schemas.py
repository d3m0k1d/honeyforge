from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class TableDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    columns: list[dict[str, Any]] = Field(default_factory=list, max_length=256)
    rows: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    # UI-метаданные конструктора (позиция на канвасе, цвет, id) —
    # хранятся как есть и возвращаются клиенту при чтении
    meta: dict[str, Any] = Field(default_factory=dict)


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    tables: list[TableDefinition] = Field(default_factory=list, max_length=256)


class WorkspaceRead(WorkspaceCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    limit: int = Field(default=1000, ge=1, le=10_000)


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    affected_rows: int = 0
