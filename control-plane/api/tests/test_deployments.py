import pytest
from pydantic import ValidationError
from sqlalchemy.orm import configure_mappers

from db.models import Base
from main import app
from modules.deployments.catalog import DEFINITIONS, validate_config


def test_deployment_tables_are_mapped() -> None:
    configure_mappers()

    assert {
        "deployment_artifacts",
        "deployments",
        "deployment_commands",
        "deployment_snapshots",
    } <= set(Base.metadata.tables)


def test_hardcoded_catalog_contains_all_levels() -> None:
    assert DEFINITIONS["ssh-low"]["driver"] == "imitor"
    assert DEFINITIONS["postgres-mid"]["driver"] == "imitor"
    assert DEFINITIONS["qemu-high"]["driver"] == "qemu-ansible"
    assert "config_schema" in DEFINITIONS["qemu-high"]


def test_high_config_is_validated() -> None:
    with pytest.raises(ValidationError):
        validate_config(
            DEFINITIONS["qemu-high"],
            {"image": "ubuntu.qcow2", "memory_mb": 128},
        )


def test_deployment_routes_are_registered() -> None:
    paths = app.openapi()["paths"]

    assert set(paths["/honeypot-types"]) == {"get"}
    assert set(paths["/deployments"]) == {"get", "post"}
    assert set(paths["/deployments/{deployment_id}/actions"]) == {"post"}
    assert set(paths["/deployments/{deployment_id}/reset"]) == {"post"}
    assert set(paths["/deployments/{deployment_id}/snapshots"]) == {
        "get",
        "post",
    }
    assert set(paths["/agents/commands/claim"]) == {"post"}
