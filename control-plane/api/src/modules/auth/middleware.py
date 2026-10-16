from collections.abc import Awaitable, Callable

from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from db.engine import async_session
from db.models import AuditLog
from modules.auth.access import user_from_access_token, user_permissions

PUBLIC_PATHS = {
    "/auth/login",
    "/agents/enroll",
    "/agents/heartbeat",
    "/agents/config",
    "/agents/events",
    "/agents/sessions",
    "/agents/artifacts",
    "/agents/honeytoken-triggers",
    "/docs",
    "/docs/oauth2-redirect",
    "/health",
    "/openapi.json",
    "/redoc",
}


def unauthorized() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": "Invalid or expired access token"},
        headers={"WWW-Authenticate": "Bearer"},
    )


class AuthenticationMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if (
            request.method == "OPTIONS"
            or request.url.path in PUBLIC_PATHS
            or request.url.path.startswith("/agents/commands/")
        ):
            return await call_next(request)

        scheme, token = get_authorization_scheme_param(
            request.headers.get("Authorization")
        )
        if scheme.lower() != "bearer" or not token:
            return unauthorized()

        async with async_session() as session:
            user = await user_from_access_token(session, token)
        if user is None:
            return unauthorized()

        granted = user_permissions(user)
        request.state.user = user
        request.state.permissions = granted
        response = await call_next(request)
        if request.method not in {"GET", "HEAD"}:
            async with async_session() as session:
                session.add(
                    AuditLog(
                        user_id=user.id,
                        method=request.method,
                        path=request.url.path,
                        status_code=response.status_code,
                        client_ip=request.client.host if request.client else None,
                        user_agent=request.headers.get("User-Agent"),
                    )
                )
                try:
                    await session.commit()
                except SQLAlchemyError:
                    await session.rollback()
        return response
