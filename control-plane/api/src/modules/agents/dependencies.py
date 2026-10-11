import secrets
from typing import Annotated, TypeAlias

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from db.engine import get_session
from db.models import Agent


async def get_gateway_agent(
    session: Annotated[AsyncSession, Depends(get_session)],
    gateway_token: Annotated[str | None, Header(alias="X-Agent-Gateway-Token")] = None,
    certificate_verified: Annotated[
        str | None, Header(alias="X-Agent-Certificate-Verified")
    ] = None,
    certificate_subject: Annotated[
        str | None, Header(alias="X-Agent-Certificate-Subject")
    ] = None,
) -> Agent:
    expected_token = Settings.AGENT_GATEWAY_TOKEN
    if (
        expected_token is None
        or gateway_token is None
        or not secrets.compare_digest(gateway_token, expected_token)
        or certificate_verified != "SUCCESS"
        or certificate_subject is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid client certificate required",
        )

    common_names = [
        part[3:] for part in certificate_subject.split(",") if part.startswith("CN=")
    ]
    if len(common_names) != 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid client certificate required",
        )

    agent = await session.scalar(
        select(Agent).where(
            Agent.external_id == common_names[0],
            Agent.enrolled_at.is_not(None),
        )
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown agent certificate",
        )
    return agent


GatewayAgent: TypeAlias = Annotated[Agent, Depends(get_gateway_agent)]
