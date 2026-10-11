from datetime import datetime
from hashlib import sha256

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Table,
    Text,
    UniqueConstraint,
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
