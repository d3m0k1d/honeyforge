from os import getenv
from pathlib import Path


class Settings:
    API_PORT = int(getenv("API_PORT", 8000))
    API_HOST = getenv("API_HOST", "0.0.0.0")

    DB_HOST = getenv("DB_HOST", "localhost")
    DB_PORT = int(getenv("DB_PORT", 5432))
    DB_USER = getenv("DB_USER", "postgres")
    DB_PASSWORD = getenv("DB_PASSWORD", "postgres")
    DB_NAME = getenv("DB_NAME", "postgres")
    DSN = getenv(
        "DATABASE_URL",
        f"postgresql+psycopg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    )

    JWT_SECRET = getenv("JWT_SECRET")
    JWT_ALGORITHM = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 30))

    INITIAL_ADMIN_EMAIL = getenv("INITIAL_ADMIN_EMAIL")
    INITIAL_ADMIN_PASSWORD = getenv("INITIAL_ADMIN_PASSWORD")

    CORS_ORIGINS = [
        origin.strip()
        for origin in getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]

    # Дополнительный regex для CORS (Starlette сравнивает его через fullmatch
    # с полным origin вида http://host:port). Нужен, чтобы панель открывалась
    # не только с localhost, но и по 127.0.0.1 / LAN-IP в приватной сети.
    # Пустое значение = дефолт; чтобы отключить — задайте несопоставимый паттерн.
    CORS_ORIGIN_REGEX = getenv("CORS_ORIGIN_REGEX") or (
        r"^https?://("
        r"localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
        r")(:\d+)?$"
    )

    MTLS_DIR = Path(getenv("MTLS_DIR", "/var/lib/honeypotforge/mtls"))
    AGENT_GATEWAY_TOKEN = getenv("AGENT_GATEWAY_TOKEN")
