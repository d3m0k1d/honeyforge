import re
import sqlite3
from typing import Annotated, TypeAlias
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import DatabaseWorkspace
from modules.auth.dependencies import requires
from modules.auth.schemas import PermissionName
from modules.database.schemas import (
    QueryRequest,
    QueryResponse,
    WorkspaceCreate,
    WorkspaceRead,
)

router = APIRouter(prefix="/databases", tags=["databases"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


def read_workspace(item: DatabaseWorkspace) -> WorkspaceRead:
    return WorkspaceRead.model_validate(
        {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "tables": item.tables or [],
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
    )


@router.get(
    "",
    response_model=list[WorkspaceRead],
    dependencies=requires(PermissionName.DATABASES_READ),
)
async def list_databases(session: Session) -> list[WorkspaceRead]:
    return [
        read_workspace(item)
        for item in (
            await session.scalars(
                select(DatabaseWorkspace).order_by(DatabaseWorkspace.name)
            )
        ).all()
    ]


@router.post(
    "",
    response_model=WorkspaceRead,
    status_code=201,
    dependencies=requires(PermissionName.DATABASES_MANAGE),
)
async def create_database(payload: WorkspaceCreate, session: Session) -> WorkspaceRead:
    item = DatabaseWorkspace(
        name=payload.name,
        description=payload.description,
        tables=[table.model_dump() for table in payload.tables],
    )
    session.add(item)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(409, "database name already exists") from None
    await session.refresh(item)
    return read_workspace(item)


@router.get(
    "/{database_id}",
    response_model=WorkspaceRead,
    dependencies=requires(PermissionName.DATABASES_READ),
)
async def get_database(database_id: UUID, session: Session) -> WorkspaceRead:
    item = await session.get(DatabaseWorkspace, database_id)
    if item is None:
        raise HTTPException(404, "database not found")
    return read_workspace(item)


@router.put(
    "/{database_id}",
    response_model=WorkspaceRead,
    dependencies=requires(PermissionName.DATABASES_MANAGE),
)
async def update_database(
    database_id: UUID, payload: WorkspaceCreate, session: Session
) -> WorkspaceRead:
    item = await session.get(DatabaseWorkspace, database_id)
    if item is None:
        raise HTTPException(404, "database not found")
    item.name = payload.name
    item.description = payload.description
    item.tables = [table.model_dump() for table in payload.tables]
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(409, "database name already exists") from None
    await session.refresh(item)
    return read_workspace(item)


@router.delete(
    "/{database_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.DATABASES_MANAGE),
)
async def delete_database(database_id: UUID, session: Session) -> None:
    item = await session.get(DatabaseWorkspace, database_id)
    if item is None:
        raise HTTPException(404, "database not found")
    await session.delete(item)
    await session.commit()


def identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise HTTPException(422, "invalid SQL identifier in workspace schema")
    return '"' + value.replace('"', '""') + '"'


def build_sqlite(item: DatabaseWorkspace) -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    for table in item.tables or []:
        columns = table.get("columns", [])
        definitions = []
        for column in columns:
            name = identifier(str(column.get("name", "")))
            kind = str(column.get("type", "TEXT")).upper()
            if kind not in {"TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"}:
                kind = "TEXT"
            definitions.append(f"{name} {kind}")
        if not definitions:
            continue
        table_name = identifier(str(table.get("name", "")))
        db.execute(f"CREATE TABLE {table_name} ({', '.join(definitions)})")
        names = [str(column.get("name")) for column in columns]
        placeholders = ",".join("?" for _ in names)
        for row in table.get("rows", []):
            quoted_names = ",".join(identifier(name) for name in names)
            db.execute(
                f"INSERT INTO {table_name} ({quoted_names}) VALUES ({placeholders})",
                [row.get(name) for name in names],
            )
    db.commit()
    return db


@router.post(
    "/{database_id}/query",
    response_model=QueryResponse,
    dependencies=requires(PermissionName.DATABASES_READ),
)
async def query_database(
    database_id: UUID, payload: QueryRequest, session: Session
) -> QueryResponse:
    item = await session.get(DatabaseWorkspace, database_id)
    if item is None:
        raise HTTPException(404, "database not found")
    if not re.match(r"^\s*(SELECT|WITH|PRAGMA)\b", payload.sql, re.IGNORECASE):
        raise HTTPException(403, "only read-only queries are allowed")
    db = build_sqlite(item)
    try:
        cursor = db.execute(payload.sql)
        rows = [list(row) for row in cursor.fetchmany(payload.limit)]
        return QueryResponse(
            columns=[column[0] for column in cursor.description or []], rows=rows
        )
    except sqlite3.Error as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        db.close()
