from codecs import lookup
from datetime import datetime
from enum import StrEnum
from pathlib import PurePosixPath

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HoneytokenFileType(StrEnum):
    ENV = "env"
    JSON = "json"
    YAML = "yaml"
    TOML = "toml"
    INI = "ini"
    PLAIN = "plain"


class HoneytokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    file_name: str = Field(min_length=1, max_length=255)
    target_path: str = Field(min_length=1, max_length=1024)
    file_type: HoneytokenFileType = HoneytokenFileType.PLAIN
    content_type: str = Field(default="text/plain", min_length=1, max_length=100)
    encoding: str = Field(default="utf-8", min_length=1, max_length=32)
    content: str = Field(max_length=1_048_576)
    is_active: bool = True

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        if value in {".", ".."} or PurePosixPath(value).name != value:
            raise ValueError("file_name must not contain a path")
        return value

    @field_validator("target_path")
    @classmethod
    def validate_target_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("target_path must be an absolute path without '..'")
        return value

    @field_validator("encoding")
    @classmethod
    def validate_encoding(cls, value: str) -> str:
        try:
            return lookup(value).name
        except LookupError:
            raise ValueError("encoding must be a known text encoding") from None


class HoneytokenRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    description: str | None
    file_name: str
    target_path: str
    file_type: HoneytokenFileType
    content_type: str
    encoding: str
    checksum_sha256: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class HoneytokenDetail(HoneytokenRead):
    content: str
