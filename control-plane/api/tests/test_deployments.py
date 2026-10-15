import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import configure_mappers

from core.config import Settings
from db.models import Base
from main import app
from modules.deployments.catalog import DEFINITIONS, validate_config
from modules.deployments.router import (
    delete_qemu_image,
    list_qemu_images,
    upload_deployment_artifact,
    upload_qemu_image,
)
from modules.deployments.schemas import ArtifactKind


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
    assert DEFINITIONS["postgres-mid"]["level"] == "medium"
    assert DEFINITIONS["qemu-high"]["driver"] == "qemu-ansible"
    assert "config_schema" in DEFINITIONS["qemu-high"]


def test_high_config_is_validated() -> None:
    with pytest.raises(ValidationError):
        validate_config(
            DEFINITIONS["qemu-high"],
            {"image": "ubuntu.qcow2", "memory_mb": 128},
        )

    config = validate_config(
        DEFINITIONS["qemu-high"],
        {
            "image": "ubuntu-cloud.qcow2",
            "cloud_init": {
                "hostname": "decoy-01",
                "username": "sensor",
                "ssh_authorized_keys": ["ssh-ed25519 AAAATEST"],
            },
        },
    )
    assert config["cloud_init"]["completion_marker"] == ("HONEYFORGE_CLOUD_INIT_DONE")

    with pytest.raises(ValidationError):
        validate_config(
            DEFINITIONS["qemu-high"],
            {
                "image": "ubuntu.qcow2",
                "port_forwards": [
                    {"protocol": "tcp", "host_port": 70000, "guest_port": 22}
                ],
            },
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
    assert set(paths["/qemu-images"]) == {"get", "post"}
    assert set(paths["/qemu-images/{image_name}"]) == {"delete"}


def test_qemu_image_upload_is_atomic_and_listable(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(Settings, "QEMU_IMAGE_DIR", tmp_path)
    monkeypatch.setattr(Settings, "QEMU_MAX_IMAGE_SIZE_BYTES", 1024)
    upload = UploadFile(filename="ubuntu.qcow2", file=BytesIO(b"fake-qcow2"))

    image = asyncio.run(upload_qemu_image(upload))
    assert image.name == "ubuntu.qcow2"
    assert image.size_bytes == 10
    assert (tmp_path / image.name).read_bytes() == b"fake-qcow2"
    assert asyncio.run(list_qemu_images()) == [image]

    asyncio.run(delete_qemu_image(image.name))
    assert not (tmp_path / image.name).exists()


def test_shell_artifact_upload_is_bounded_and_stored() -> None:
    class FakeSession:
        def add(self, artifact) -> None:
            self.artifact = artifact

        async def commit(self) -> None:
            self.artifact.id = "artifact-id"

        async def refresh(self, _artifact) -> None:
            return None

    session = FakeSession()
    upload = UploadFile(
        filename="configure.sh", file=BytesIO(b"#!/bin/sh\necho ready\n")
    )
    artifact = asyncio.run(
        upload_deployment_artifact(
            user=SimpleNamespace(id=1),
            session=session,
            kind=ArtifactKind.SHELL,
            entrypoint="configure.sh",
            file=upload,
        )
    )
    assert artifact.kind == ArtifactKind.SHELL
    assert session.artifact.content == b"#!/bin/sh\necho ready\n"
    assert session.artifact.size_bytes == len(session.artifact.content)
