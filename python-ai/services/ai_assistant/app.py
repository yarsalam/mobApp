import logging
import os
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.assistant import router as assistant_router

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

redis_client: aioredis.Redis = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(
        os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
    )
    logger.info("AI Assistant started")
    yield
    await redis_client.aclose()
    logger.info("AI Assistant stopped")


app = FastAPI(title="AI Assistant Service", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(assistant_router, prefix="/api/assistant", tags=["assistant"])


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_assistant",
        "version": "2.0.0",
        "redis": redis_client is not None,
    }


@app.get("/")
async def root():
    return {
        "name": "AI Assistant Service",
        "version": "2.0.0",
        "endpoints": [
            "/api/assistant/analyze",
            "/api/assistant/advice/{user_id}",
            "/api/assistant/chat",
            "/health",
        ],
    }
