from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import Settings
from db.engine import engine
from db.init import init_db
from modules.auth.router import router as auth_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(title="HoneypotForge API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=Settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host=Settings.API_HOST, port=Settings.API_PORT)
