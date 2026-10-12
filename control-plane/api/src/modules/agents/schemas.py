from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

AGENT_ID_PATTERN = r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$"
BUILTIN_SERVICE_TYPES = {
    "ssh",
    "ftp",
    "smtp",
    "telnet",
    "pop3",
    "imap",
    "memcached",
    "irc",
    "nntp",
    "rsync",
    "redis",
    "vnc",
    "http",
    "http-nginx",
    "nginx",
    "apache",
    "http-apache",
    "iis",
    "tomcat",
    "grafana",
    "jenkins",
    "docker",
    "kubernetes",
    "elasticsearch",
    "prometheus",
    "webmin",
    "phpmyadmin",
    "wordpress",
    "router",
    "hikvision",
    "mysql",
    "postgres",
    "postgresql",
    "psql",
}


class EnrollmentTokenCreate(BaseModel):
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    expires_in_minutes: int = Field(default=15, ge=1, le=1440)


class EnrollmentTokenRead(BaseModel):
    agent_id: str
    token: str
    expires_at: datetime


class AgentEnroll(BaseModel):
    token: str = Field(min_length=32, max_length=256)


class AgentHeartbeatRead(BaseModel):
    agent_id: str
    last_heartbeat_at: datetime


class ConfigObject(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentLog(ConfigObject):
    output: str = ""


class AgentMasking(ConfigObject):
    endpoint_path: str = Field(default="/assets/collect", min_length=1, max_length=255)
    beacon_interval_seconds: int = Field(default=5, ge=1, le=3600)
    jitter_seconds: int = Field(default=2, ge=0, le=3600)
    padding_bytes: int = Field(default=0, ge=0, le=65_536)
    mgmt_interface: str | None = Field(default=None, max_length=64)


class AgentHoneytoken(ConfigObject):
    id: int
    name: str
    file_name: str
    target_path: str
    content_type: str
    encoding: str
    content: str
    checksum_sha256: str


class ServiceRule(ConfigObject):
    name: str = ""
    pattern: str = ""
    response: str = ""
    delay: StrictInt | str = 0
    jitter: StrictInt | str = 0
    capture: list[str] = Field(default_factory=list)
    on: str = ""
    set_state: str = ""
    clear_state: StrictBool = False
    once: StrictBool = False
    close: StrictBool = False


class AgentService(ConfigObject):
    type: str = Field(min_length=1)
    name: str = ""
    level: str = ""
    listen: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    max_conns: StrictInt = 0
    idle_timeout: StrictInt | str = 0
    delay: StrictInt | str = 0
    jitter: StrictInt | str = 0
    initial_delay: StrictInt | str = 0
    log_input: StrictBool | None = None
    params: dict[str, str] = Field(default_factory=dict)
    greeting: str = ""
    rules: list[ServiceRule] = Field(default_factory=list)

    @field_validator("type", "level")
    @classmethod
    def normalize(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def structural_fields(self) -> "AgentService":
        if not self.type:
            raise ValueError("service type is required")
        if self.level not in ("", "low", "medium"):
            raise ValueError("level must be low or medium")
        if bool(self.tls_cert) != bool(self.tls_key):
            raise ValueError("tls_cert and tls_key must be set together")
        if self.type not in BUILTIN_SERVICE_TYPES:
            if not self.listen:
                raise ValueError("listen is required for custom services")
            if self.level != "low":
                if self.type != "line" and not self.rules:
                    raise ValueError("unknown service type requires rules")
                if not self.greeting and not self.rules:
                    raise ValueError("line service requires greeting and/or rules")
        if self.listen:
            host, separator, port = self.listen.rpartition(":")
            if (
                not separator
                or not port.isascii()
                or not port.isdigit()
                or not 0 <= int(port) <= 65535
                or (":" in host and not (host.startswith("[") and host.endswith("]")))
            ):
                raise ValueError("listen must be a host:port address")
        return self


class AgentConfigWrite(ConfigObject):
    version: int | None = None
    log: AgentLog = Field(default_factory=AgentLog)
    services: list[AgentService]
    masking: AgentMasking | None = None
    honeytokens: list[AgentHoneytoken] = Field(default_factory=list)


class AgentConfigRead(ConfigObject):
    version: int = Field(gt=0)
    log: AgentLog
    services: list[AgentService]
    masking: AgentMasking | None = None
    honeytokens: list[AgentHoneytoken] = Field(default_factory=list)


EventString = Annotated[str, Field(min_length=1, max_length=256)]
DataKey = Annotated[str, Field(max_length=128)]
DataValue = Annotated[str, Field(max_length=4096)]


class AgentEventRead(ConfigObject):
    id: UUID
    ts: AwareDatetime
    service: EventString
    level: str | None = Field(default=None, max_length=64)
    src: str | None = Field(default=None, max_length=512)
    event: EventString
    rule: str | None = Field(default=None, max_length=256)
    data: dict[DataKey, DataValue] | None = Field(default=None, max_length=64)


class AgentEventBatch(ConfigObject):
    events: list[AgentEventRead] = Field(min_length=1, max_length=100)


class AgentRead(BaseModel):
    agent_id: str
    created_at: datetime
    enrolled_at: datetime | None
    last_heartbeat_at: datetime | None
    online: bool
    profile_id: UUID | None = None
    profile_name: str | None = None
