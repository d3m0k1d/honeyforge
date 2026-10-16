from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from core.config import Settings

password_hash = PasswordHash.recommended()


def jwt_secret() -> str:
    if not Settings.JWT_SECRET or len(Settings.JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters")
    return Settings.JWT_SECRET


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def create_access_token(user_id: int) -> tuple[str, int]:
    expires_in = Settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "type": "access",
    }
    token = jwt.encode(payload, jwt_secret(), algorithm=Settings.JWT_ALGORITHM)
    return token, expires_in


def decode_access_token(token: str) -> int:
    payload = jwt.decode(token, jwt_secret(), algorithms=[Settings.JWT_ALGORITHM])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")

    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError) as error:
        raise jwt.InvalidTokenError("Invalid token subject") from error
