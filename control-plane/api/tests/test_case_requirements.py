import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import Settings
from db.engine import get_session
from db.models import Agent, Base, Permission, Role, User
from main import app
from modules.auth import middleware
from modules.auth.schemas import PermissionName
from modules.events import router as events_router


@pytest.fixture
def case_api(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'case.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    agent_id = f"case-{uuid4()}"

    async def setup() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add(
                Agent(
                    external_id=agent_id,
                    enrolled_at=datetime.now(UTC),
                    last_heartbeat_at=datetime.now(UTC),
                )
            )
            await session.commit()

    asyncio.run(setup())

    async def test_session():
        async with sessions() as session:
            yield session

    async def test_user(_session, token):
        if token != "operator":
            return None
        return User(
            id=1,
            roles=[
                Role(
                    permissions=[
                        Permission(name=permission) for permission in PermissionName
                    ]
                )
            ],
        )

    app.dependency_overrides[get_session] = test_session
    monkeypatch.setattr(middleware, "async_session", sessions)
    monkeypatch.setattr(middleware, "user_from_access_token", test_user)
    monkeypatch.setattr(events_router, "async_session", sessions)
    monkeypatch.setattr(events_router, "user_from_access_token", test_user)
    monkeypatch.setattr(Settings, "AGENT_GATEWAY_TOKEN", "gateway-secret")
    client = TestClient(app)
    try:
        yield client, agent_id
    finally:
        client.close()
        app.dependency_overrides.pop(get_session, None)
        asyncio.run(engine.dispose())


def agent_headers(agent_id: str) -> dict[str, str]:
    return {
        "X-Agent-Gateway-Token": "gateway-secret",
        "X-Agent-Certificate-Verified": "SUCCESS",
        "X-Agent-Certificate-Subject": f"CN={agent_id}",
    }


def test_profile_agent_config_and_status(case_api) -> None:
    client, agent_id = case_api
    operator = {"Authorization": "Bearer operator"}
    payload = {
        "name": "demo-medium",
        "description": "Low and medium demo profile",
        "level": "medium",
        "services": [
            {"type": "ftp", "level": "low", "listen": ":2121"},
            {"type": "ssh", "level": "medium", "listen": ":2222"},
        ],
        "logging": {"output": ""},
        "masking": {
            "endpoint_path": "/assets/collect",
            "beacon_interval_seconds": 5,
            "jitter_seconds": 2,
            "padding_bytes": 128,
        },
        "honeytoken_ids": [],
    }
    response = client.post("/profiles", headers=operator, json=payload)
    assert response.status_code == 201, response.text
    profile_id = response.json()["id"]

    response = client.put(f"/profiles/{profile_id}/agents/{agent_id}", headers=operator)
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    assert len(response.json()["services"]) == 2

    response = client.get("/agents/config", headers=agent_headers(agent_id))
    assert response.status_code == 200, response.text
    assert response.json()["masking"]["jitter_seconds"] == 2

    agents = client.get("/agents", headers=operator).json()
    assert agents[0]["online"] is True
    assert agents[0]["profile_id"] == profile_id
    assert agents[0]["profile_name"] == "demo-medium"

    audit = client.get("/audit", headers=operator)
    assert audit.status_code == 200, audit.text
    assert {row["path"] for row in audit.json()} >= {
        "/profiles",
        f"/profiles/{profile_id}/agents/{agent_id}",
    }


def test_telemetry_filters_realtime_and_exports(case_api) -> None:
    client, agent_id = case_api
    operator = {"Authorization": "Bearer operator"}
    event_id = str(uuid4())
    event = {
        "id": event_id,
        "ts": "2026-10-12T12:00:00Z",
        "service": "ssh",
        "level": "medium",
        "src": "192.0.2.10:4242",
        "event": "authentication",
        "rule": "password",
        "data": {"username": "root", "asn": "AS64500", "geo": "RU"},
    }
    headers = agent_headers(agent_id)
    for _ in range(2):
        response = client.post(
            "/agents/events", headers=headers, json={"events": [event]}
        )
        assert response.status_code == 200, response.text

    response = client.get(
        "/events",
        headers=operator,
        params={"agent_id": agent_id, "src": event["src"], "event": event["event"]},
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    assert response.json()[0]["geo"] == "RU"
    assert response.json()[0]["asn"] == "AS64500"

    stats = client.get("/events/stats", headers=operator).json()
    assert stats["total"] == 1
    assert stats["top_sources"][event["src"]] == 1

    csv_response = client.get("/events/export.csv", headers=operator)
    assert csv_response.status_code == 200
    assert event_id in csv_response.text
    stix = client.get("/events/export.stix", headers=operator).json()
    assert stix["type"] == "bundle"
    assert "192.0.2.10" in stix["objects"][0]["pattern"]

    with client.websocket_connect("/events/ws?token=operator&cursor=0") as websocket:
        realtime = websocket.receive_json()
    assert realtime["event_id"] == event_id
    assert realtime["agent_id"] == agent_id


def test_threshold_alert_and_acknowledgement(case_api) -> None:
    client, agent_id = case_api
    operator = {"Authorization": "Bearer operator"}
    response = client.post(
        "/alerts/rules",
        headers=operator,
        json={
            "name": "repeated-logins",
            "event": "authentication",
            "service": "ssh",
            "threshold": 2,
            "window_seconds": 60,
        },
    )
    assert response.status_code == 201, response.text

    timestamp = datetime.now(UTC).isoformat()
    events = [
        {
            "id": str(uuid4()),
            "ts": timestamp,
            "service": "ssh",
            "level": "medium",
            "src": "198.51.100.7",
            "event": "authentication",
            "data": {"username": "root"},
        }
        for _ in range(2)
    ]
    response = client.post(
        "/agents/events", headers=agent_headers(agent_id), json={"events": events}
    )
    assert response.status_code == 200, response.text

    alerts = client.get("/alerts?acknowledged=false", headers=operator).json()
    assert len(alerts) == 1
    assert alerts[0]["event_count"] == 2
    response = client.post(f"/alerts/{alerts[0]['id']}/acknowledge", headers=operator)
    assert response.status_code == 200, response.text
    assert response.json()["acknowledged"] is True
