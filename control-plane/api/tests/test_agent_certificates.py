from io import BytesIO
from zipfile import ZipFile

import pytest

from core.config import Settings
from main import app
from modules.agents.router import CERTIFICATE_FILES, build_certificate_bundle


def test_agent_certificate_routes_are_registered() -> None:
    paths = app.openapi()["paths"]

    assert set(paths["/agents/{agent_id}/certificate"]) == {"get"}
    assert set(paths["/agents/enrollment-tokens"]) == {"post"}
    assert set(paths["/agents/enroll"]) == {"post"}
    assert set(paths["/agents/heartbeat"]) == {"post"}


def test_build_certificate_bundle(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Settings, "MTLS_DIR", tmp_path)
    certificate_dir = tmp_path / "clients" / "agent-001"
    certificate_dir.mkdir(parents=True)
    for file_name in CERTIFICATE_FILES:
        (certificate_dir / file_name).write_text(file_name)

    content = build_certificate_bundle("agent-001")

    with ZipFile(BytesIO(content)) as archive:
        assert set(archive.namelist()) == set(CERTIFICATE_FILES)
        assert archive.read("client.crt") == b"client.crt"


def test_build_certificate_bundle_rejects_unknown_agent(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Settings, "MTLS_DIR", tmp_path)

    with pytest.raises(FileNotFoundError):
        build_certificate_bundle("missing-agent")
