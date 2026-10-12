from datetime import datetime
from typing import Annotated, TypeAlias

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import AuditLog
from modules.audit.schemas import AuditLogRead
from modules.auth.dependencies import requires
from modules.auth.schemas import PermissionName

router = APIRouter(prefix="/audit", tags=["audit"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "",
    response_model=list[AuditLogRead],
    dependencies=requires(PermissionName.AUDIT_READ),
)
async def list_audit_logs(
    session: Session,
    user_id: int | None = Query(default=None, ge=1),
    since: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[AuditLog]:
    query = select(AuditLog)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if since is not None:
        query = query.where(AuditLog.created_at >= since)
    return list(
        await session.scalars(
            query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
