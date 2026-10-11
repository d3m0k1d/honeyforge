from collections.abc import Awaitable, Callable

from fastapi.security.utils import get_authorization_scheme_param
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from db.engine import async_session
from modules.auth.access import user_from_access_token, user_permissions

PUBLIC_PATHS = {
    "/auth/login",
    "/auth/register",
    "/agents/enroll",
    "/agents/heartbeat",
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
        if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
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
        return await call_next(request)
