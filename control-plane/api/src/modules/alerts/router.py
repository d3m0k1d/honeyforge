from datetime import UTC, datetime
from typing import Annotated, TypeAlias
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.engine import get_session
from db.models import Alert, AlertRule
from modules.alerts.schemas import AlertRead, AlertRuleCreate, AlertRuleRead
from modules.auth.dependencies import CurrentUser, requires
from modules.auth.schemas import PermissionName

router = APIRouter(prefix="/alerts", tags=["alerts"])
Session: TypeAlias = Annotated[AsyncSession, Depends(get_session)]


async def get_rule(session: AsyncSession, rule_id: UUID) -> AlertRule:
    rule = await session.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return rule


def apply_rule(rule: AlertRule, payload: AlertRuleCreate) -> None:
    for key, value in payload.model_dump().items():
        setattr(rule, key, value)


@router.post(
    "/rules",
    response_model=AlertRuleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=requires(PermissionName.ALERTS_MANAGE),
)
async def create_rule(
    payload: AlertRuleCreate, user: CurrentUser, session: Session
) -> AlertRule:
    rule = AlertRule(created_by_id=user.id)
    apply_rule(rule, payload)
    session.add(rule)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="Rule name already exists"
        ) from None
    await session.refresh(rule)
    return rule


@router.get(
    "/rules",
    response_model=list[AlertRuleRead],
    dependencies=requires(PermissionName.ALERTS_READ),
)
async def list_rules(session: Session) -> list[AlertRule]:
    return list(await session.scalars(select(AlertRule).order_by(AlertRule.name)))


@router.put(
    "/rules/{rule_id}",
    response_model=AlertRuleRead,
    dependencies=requires(PermissionName.ALERTS_MANAGE),
)
async def update_rule(
    rule_id: UUID, payload: AlertRuleCreate, session: Session
) -> AlertRule:
    rule = await get_rule(session, rule_id)
    apply_rule(rule, payload)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="Rule name already exists"
        ) from None
    await session.refresh(rule)
    return rule


@router.delete(
    "/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=requires(PermissionName.ALERTS_MANAGE),
)
async def delete_rule(rule_id: UUID, session: Session) -> Response:
    rule = await get_rule(session, rule_id)
    await session.delete(rule)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def alert_response(alert: Alert) -> AlertRead:
    return AlertRead(
        id=alert.id,
        rule_id=alert.rule_id,
        rule_name=alert.rule.name,
        agent_id=alert.agent.external_id,
        source=alert.source,
        event_count=alert.event_count,
        triggered_at=alert.triggered_at,
        acknowledged=alert.acknowledged,
        acknowledged_at=alert.acknowledged_at,
    )


@router.get(
    "",
    response_model=list[AlertRead],
    dependencies=requires(PermissionName.ALERTS_READ),
)
async def list_alerts(
    session: Session, acknowledged: bool | None = None
) -> list[AlertRead]:
    query = select(Alert).options(selectinload(Alert.rule), selectinload(Alert.agent))
    if acknowledged is not None:
        query = query.where(Alert.acknowledged == acknowledged)
    alerts = await session.scalars(query.order_by(Alert.triggered_at.desc()))
    return [alert_response(alert) for alert in alerts]


@router.post(
    "/{alert_id}/acknowledge",
    response_model=AlertRead,
    dependencies=requires(PermissionName.ALERTS_MANAGE),
)
async def acknowledge_alert(alert_id: UUID, session: Session) -> AlertRead:
    alert = await session.scalar(
        select(Alert)
        .where(Alert.id == alert_id)
        .options(selectinload(Alert.rule), selectinload(Alert.agent))
    )
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    alert.acknowledged_at = datetime.now(UTC)
    await session.commit()
    return alert_response(alert)
