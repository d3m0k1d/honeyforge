from hashlib import sha256

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import configure_mappers

from db.init import ROLE_PERMISSIONS
from db.models import Agent, Base, Honeytoken, User
from modules.auth.schemas import PermissionName, RoleName
from modules.honeytokens.schemas import HoneytokenCreate, HoneytokenFileType


def test_honeytoken_model_is_mapped() -> None:
    configure_mappers()

    table = Base.metadata.tables["honeytokens"]
    assert {
        "id",
        "user_id",
        "name",
        "file_name",
        "target_path",
        "content",
        "checksum_sha256",
    } <= set(table.columns.keys())
    assert User.honeytokens.property.back_populates == "user"


def test_agent_enrollment_model_is_mapped() -> None:
    configure_mappers()

    table = Base.metadata.tables["agents"]
    assert {
        "external_id",
        "enrollment_token_hash",
        "enrollment_expires_at",
        "enrolled_at",
        "last_heartbeat_at",
    } <= set(table.columns.keys())
    assert Agent.created_by.property.back_populates == "created_agents"


def test_honeytoken_updates_checksum_with_content() -> None:
    content = "DATABASE_URL=postgresql://decoy:decoy@example/db\n"

    honeytoken = Honeytoken(
        user_id=1,
        name="backend production env",
        file_name=".env",
        target_path="/opt/backend/.env",
        file_type=HoneytokenFileType.ENV,
        content=content,
    )

    assert honeytoken.checksum_sha256 == sha256(content.encode()).hexdigest()


def test_honeytoken_permissions_are_assigned_to_roles() -> None:
    assert PermissionName.HONEYTOKENS_MANAGE in ROLE_PERMISSIONS[RoleName.OPERATOR]
    assert PermissionName.HONEYTOKENS_READ in ROLE_PERMISSIONS[RoleName.VIEWER]


@pytest.mark.parametrize(
    "field,value",
    [
        ("file_name", "secrets/.env"),
        ("target_path", "relative/.env"),
        ("target_path", "/opt/../root/.env"),
    ],
)
def test_honeytoken_rejects_unsafe_paths(field: str, value: str) -> None:
    payload = {
        "name": "test token",
        "file_name": ".env",
        "target_path": "/opt/backend/.env",
        "file_type": "env",
        "content": "API_KEY=decoy",
        field: value,
    }

    with pytest.raises(ValidationError):
        HoneytokenCreate.model_validate(payload)
