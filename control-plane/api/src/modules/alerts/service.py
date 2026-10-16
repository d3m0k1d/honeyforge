from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentEvent, Alert, AlertRule


async def evaluate_alerts(
    session: AsyncSession, agent_id: int, event_types: set[tuple[str, str | None]]
) -> None:
    if not event_types:
        return
    rules = await session.scalars(select(AlertRule).where(AlertRule.enabled.is_(True)))
    now = datetime.now(UTC)
    for rule in rules:
        if not any(
            event == rule.event and (rule.service is None or service == rule.service)
            for event, service in event_types
        ):
            continue
        cutoff = now - timedelta(seconds=rule.window_seconds)
        query = select(AgentEvent.src, func.count()).where(
            AgentEvent.agent_id == agent_id,
            AgentEvent.event == rule.event,
            AgentEvent.ts >= cutoff,
        )
        if rule.service is not None:
            query = query.where(AgentEvent.service == rule.service)
        sources = await session.execute(query.group_by(AgentEvent.src))
        for source, count in sources:
            if count < rule.threshold:
                continue
            existing = await session.scalar(
                select(Alert.id).where(
                    Alert.rule_id == rule.id,
                    Alert.agent_id == agent_id,
                    Alert.source == source,
                    Alert.triggered_at >= cutoff,
                )
            )
            if existing is None:
                session.add(
                    Alert(
                        rule_id=rule.id,
                        agent_id=agent_id,
                        source=source,
                        event_count=count,
                        triggered_at=now,
                    )
                )
