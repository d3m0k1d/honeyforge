from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SERVICE_TYPES = (
    "apache",
    "docker",
    "elasticsearch",
    "ftp",
    "grafana",
    "hikvision",
    "http",
    "iis",
    "imap",
    "irc",
    "jenkins",
    "kubernetes",
    "memcached",
    "mysql",
    "nginx",
    "nntp",
    "phpmyadmin",
    "pop3",
    "postgres",
    "prometheus",
    "redis",
    "router",
    "rsync",
    "smtp",
    "ssh",
    "telnet",
    "tomcat",
    "vnc",
    "webmin",
    "wordpress",
)


class ServiceConfig(BaseModel):
    listen: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=100)
    max_connections: int = Field(default=256, ge=1, le=10_000)
    idle_timeout_seconds: int = Field(default=30, ge=1, le=3600)
    delay_ms: int = Field(default=0, ge=0, le=60_000)
    jitter_ms: int = Field(default=0, ge=0, le=60_000)
    log_input: bool = True
    params: dict[str, str] = Field(default_factory=dict)
    honeytoken_ids: list[int] = Field(default_factory=list, max_length=100)


class CloudInitConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hostname: str = Field(
        default="honeypot", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$"
    )
    username: str = Field(default="honeypot", pattern=r"^[a-z_][a-z0-9_-]{0,31}$")
    ssh_authorized_keys: list[str] = Field(default_factory=list, max_length=32)
    user_data: str | None = Field(default=None, max_length=1_048_576)
    network_config: str | None = Field(default=None, max_length=262_144)
    wait_timeout_seconds: int = Field(default=300, ge=0, le=7200)
    completion_marker: str = Field(
        default="HONEYFORGE_CLOUD_INIT_DONE", min_length=1, max_length=128
    )


class HighConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image: str = Field(min_length=1, max_length=255)
    vcpus: int = Field(default=2, ge=1, le=32)
    memory_mb: int = Field(default=2048, ge=256, le=65_536)
    disk_gb: int = Field(default=20, ge=1, le=2048)
    provisioning_artifact_id: str | None = None
    provisioning_timeout_seconds: int = Field(default=600, ge=10, le=7200)
    honeytoken_ids: list[int] = Field(default_factory=list, max_length=100)
    reset_interval_minutes: int | None = Field(default=None, ge=1, le=43_200)
    preserve_incident_on_reset: bool = True
    max_incident_snapshots: int = Field(default=10, ge=0, le=1000)
    port_forwards: list["PortForward"] = Field(default_factory=list, max_length=32)
    cloud_init: CloudInitConfig | None = None


class PortForward(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol: Literal["tcp", "udp"] = "tcp"
    listen_host: str = Field(default="0.0.0.0", min_length=1, max_length=45)
    host_port: int = Field(ge=1, le=65535)
    guest_port: int = Field(ge=1, le=65535)


def definitions() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    service_schema = ServiceConfig.model_json_schema()
    for service_type in SERVICE_TYPES:
        for suffix, level in (("low", "low"), ("mid", "medium")):
            slug = f"{service_type}-{suffix}"
            result[slug] = {
                "slug": slug,
                "level": level,
                "driver": "imitor",
                "version": 1,
                "config_schema": service_schema,
            }
    result["qemu-high"] = {
        "slug": "qemu-high",
        "level": "high",
        "driver": "qemu-ansible",
        "version": 1,
        "config_schema": HighConfig.model_json_schema(),
    }
    return result


DEFINITIONS = definitions()


def validate_config(
    definition: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    model = HighConfig if definition["level"] == "high" else ServiceConfig
    return model.model_validate(config).model_dump(mode="json")
