from datetime import datetime
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    true,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    validates,
)


class Base(DeclarativeBase):
    pass


user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "permission_id",
        ForeignKey("permissions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    roles: Mapped[list["Role"]] = relationship(
        secondary=user_roles, back_populates="users"
    )
    honeytokens: Mapped[list["Honeytoken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    created_agents: Mapped[list["Agent"]] = relationship(back_populates="created_by")
    deployment_artifacts: Mapped[list["DeploymentArtifact"]] = relationship(
        back_populates="created_by"
    )
    deployments: Mapped[list["Deployment"]] = relationship(back_populates="created_by")
    profiles: Mapped[list["HoneypotProfile"]] = relationship(
        back_populates="created_by"
    )
    alert_rules: Mapped[list["AlertRule"]] = relationship(back_populates="created_by")


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    users: Mapped[list[User]] = relationship(
        secondary=user_roles, back_populates="roles"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        secondary=role_permissions, back_populates="roles"
    )


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    roles: Mapped[list[Role]] = relationship(
        secondary=role_permissions, back_populates="permissions"
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_created_user", "created_at", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(1024))
    status_code: Mapped[int] = mapped_column(Integer)
    client_ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    enrollment_token_hash: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True
    )
    enrollment_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by: Mapped[User | None] = relationship(back_populates="created_agents")
    deployments: Mapped[list["Deployment"]] = relationship(back_populates="agent")
    commands: Mapped[list["DeploymentCommand"]] = relationship(back_populates="agent")
    configuration: Mapped["AgentConfiguration | None"] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )
    events: Mapped[list["AgentEvent"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )
    attack_sessions: Mapped[list["AttackSession"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )
    captured_artifacts: Mapped[list["CapturedArtifact"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )
    honeytoken_triggers: Mapped[list["HoneytokenTrigger"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )


class AgentConfiguration(Base):
    __tablename__ = "agent_configurations"

    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    profile_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("honeypot_profiles.id", ondelete="SET NULL"), index=True
    )
    agent: Mapped[Agent] = relationship(back_populates="configuration")
    profile: Mapped["HoneypotProfile | None"] = relationship(
        back_populates="configurations"
    )


class AgentEvent(Base):
    __tablename__ = "agent_events"
    __table_args__ = (
        UniqueConstraint("agent_id", "event_id", name="uq_agent_events_external_id"),
        Index("ix_agent_events_agent_ts", "agent_id", "ts"),
        Index("ix_agent_events_src_event", "src", "event"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[UUID] = mapped_column(Uuid)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    service: Mapped[str] = mapped_column(String(256))
    level: Mapped[str | None] = mapped_column(String(64))
    src: Mapped[str | None] = mapped_column(String(512))
    event: Mapped[str] = mapped_column(String(256))
    rule: Mapped[str | None] = mapped_column(String(256))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    agent: Mapped[Agent] = relationship(back_populates="events")


class AttackSession(Base):
    __tablename__ = "attack_sessions"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_attack_sessions_session_id"),
        Index("ix_attack_sessions_agent_started", "agent_id", "started_at"),
        Index("ix_attack_sessions_src_service", "src", "service"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[UUID] = mapped_column(Uuid)
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    service: Mapped[str] = mapped_column(String(256))
    level: Mapped[str | None] = mapped_column(String(64))
    src: Mapped[str | None] = mapped_column(String(512))
    protocol: Mapped[str | None] = mapped_column(String(32))
    source_port: Mapped[int | None] = mapped_column(Integer)
    destination_port: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(String(512))
    credentials: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    commands: Mapped[list[str]] = mapped_column(JSON, default=list)
    requests: Mapped[list[str]] = mapped_column(JSON, default=list)
    transcript: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    agent: Mapped[Agent] = relationship(back_populates="attack_sessions")


class CapturedArtifact(Base):
    __tablename__ = "captured_artifacts"
    __table_args__ = (
        UniqueConstraint("artifact_id", name="uq_captured_artifacts_artifact_id"),
        Index("ix_captured_artifacts_agent_uploaded", "agent_id", "uploaded_at"),
        Index("ix_captured_artifacts_checksum", "checksum_sha256"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    artifact_id: Mapped[UUID] = mapped_column(Uuid)
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    event_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    agent: Mapped[Agent] = relationship(back_populates="captured_artifacts")


class HoneytokenTrigger(Base):
    __tablename__ = "honeytoken_triggers"
    __table_args__ = (
        UniqueConstraint("trigger_id", name="uq_honeytoken_triggers_trigger_id"),
        Index("ix_honeytoken_triggers_token_ts", "honeytoken_id", "triggered_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trigger_id: Mapped[UUID] = mapped_column(Uuid)
    honeytoken_id: Mapped[int] = mapped_column(
        ForeignKey("honeytokens.id", ondelete="RESTRICT"), index=True
    )
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    src: Mapped[str | None] = mapped_column(String(512))
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    agent: Mapped[Agent] = relationship(back_populates="honeytoken_triggers")
    honeytoken: Mapped["Honeytoken"] = relationship(back_populates="triggers")


class HoneypotProfile(Base):
    __tablename__ = "honeypot_profiles"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(16))
    services: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    logging: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    masking: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    honeytoken_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[User | None] = relationship(back_populates="profiles")
    configurations: Mapped[list[AgentConfiguration]] = relationship(
        back_populates="profile"
    )


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    event: Mapped[str] = mapped_column(String(256))
    service: Mapped[str | None] = mapped_column(String(256))
    threshold: Mapped[int] = mapped_column(Integer)
    window_seconds: Mapped[int] = mapped_column(Integer)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by: Mapped[User | None] = relationship(back_populates="alert_rules")
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="rule", cascade="all, delete-orphan"
    )


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_triggered_ack", "triggered_at", "acknowledged"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    rule_id: Mapped[UUID] = mapped_column(
        ForeignKey("alert_rules.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str | None] = mapped_column(String(512))
    event_count: Mapped[int] = mapped_column(Integer)
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    acknowledged: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rule: Mapped[AlertRule] = relationship(back_populates="alerts")
    agent: Mapped[Agent] = relationship()


class DatabaseWorkspace(Base):
    """Portable schema/data model used by the database designer API.

    The agent owns the runtime SQLite file; the control plane stores the
    designer definition so it can be assigned to more than one agent.
    """

    __tablename__ = "database_workspaces"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    tables: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DeploymentArtifact(Base):
    __tablename__ = "deployment_artifacts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    entrypoint: Mapped[str] = mapped_column(String(255))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str] = mapped_column(String(64), index=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by: Mapped[User | None] = relationship(
        back_populates="deployment_artifacts"
    )


class Deployment(Base):
    __tablename__ = "deployments"
    __table_args__ = (Index("ix_deployments_agent_state", "agent_id", "desired_state"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100))
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="RESTRICT"), index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    honeypot_type: Mapped[str] = mapped_column(String(100))
    definition_version: Mapped[int] = mapped_column(Integer, default=1)
    level: Mapped[str] = mapped_column(String(16))
    driver: Mapped[str] = mapped_column(String(32))
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    desired_state: Mapped[str] = mapped_column(String(32), default="running")
    observed_state: Mapped[str] = mapped_column(String(32), default="pending")
    generation: Mapped[int] = mapped_column(Integer, default=1)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    agent: Mapped[Agent] = relationship(back_populates="deployments")
    created_by: Mapped[User | None] = relationship(back_populates="deployments")
    commands: Mapped[list["DeploymentCommand"]] = relationship(
        back_populates="deployment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    snapshots: Mapped[list["DeploymentSnapshot"]] = relationship(
        back_populates="deployment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class DeploymentSnapshot(Base):
    __tablename__ = "deployment_snapshots"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    deployment_id: Mapped[UUID] = mapped_column(
        ForeignKey("deployments.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))
    state: Mapped[str] = mapped_column(String(32), default="creating")
    path: Mapped[str | None] = mapped_column(String(1024))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deployment: Mapped[Deployment] = relationship(back_populates="snapshots")


class DeploymentCommand(Base):
    __tablename__ = "deployment_commands"
    __table_args__ = (
        Index("ix_commands_agent_status_created", "agent_id", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    deployment_id: Mapped[UUID] = mapped_column(
        ForeignKey("deployments.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    generation: Mapped[int] = mapped_column(Integer)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deployment: Mapped[Deployment] = relationship(back_populates="commands")
    agent: Mapped[Agent] = relationship(back_populates="commands")


class Honeytoken(Base):
    __tablename__ = "honeytokens"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_honeytokens_user_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    target_path: Mapped[str] = mapped_column(String(1024))
    file_type: Mapped[str] = mapped_column(String(32), default="plain")
    content_type: Mapped[str] = mapped_column(String(100), default="text/plain")
    encoding: Mapped[str] = mapped_column(String(32), default="utf-8")
    content: Mapped[str] = mapped_column(Text)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    user: Mapped[User] = relationship(back_populates="honeytokens")
    triggers: Mapped[list[HoneytokenTrigger]] = relationship(
        back_populates="honeytoken", passive_deletes=True
    )

    @validates("content")
    def update_checksum(self, _: str, content: str) -> str:
        encoding = self.encoding or "utf-8"
        self.checksum_sha256 = sha256(content.encode(encoding)).hexdigest()
        return content

    @validates("encoding")
    def update_encoding(self, _: str, encoding: str) -> str:
        content = getattr(self, "content", None)
        if content is not None:
            self.checksum_sha256 = sha256(content.encode(encoding)).hexdigest()
        return encoding
