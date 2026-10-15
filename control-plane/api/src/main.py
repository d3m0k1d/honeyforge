from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import Settings
from db.engine import engine
from db.init import init_db
from modules.agents.router import router as agents_router
from modules.alerts.router import router as alerts_router
from modules.analytics.router import router as analytics_router
from modules.audit.router import router as audit_router
from modules.auth.middleware import AuthenticationMiddleware
from modules.auth.router import router as auth_router
from modules.database.router import router as databases_router
from modules.deployments.router import router as deployments_router
from modules.events.router import router as events_router
from modules.honeytokens.router import router as honeytokens_router
from modules.profiles.router import router as profiles_router
from modules.telemetry.router import router as telemetry_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(title="HoneypotForge API", lifespan=lifespan)
app.add_middleware(AuthenticationMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=Settings.CORS_ORIGINS,
    allow_origin_regex=Settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(honeytokens_router)
app.include_router(agents_router)
app.include_router(deployments_router)
app.include_router(profiles_router)
app.include_router(events_router)
app.include_router(audit_router)
app.include_router(alerts_router)
app.include_router(telemetry_router)
app.include_router(databases_router)
app.include_router(analytics_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host=Settings.API_HOST, port=Settings.API_PORT)
