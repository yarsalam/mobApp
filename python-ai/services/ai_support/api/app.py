import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, Optional

import redis.asyncio as aioredis
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core.ticket_analyzer import AISupportEngine

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv(
    "REDIS_URL",
    f"redis://{os.getenv('REDIS_HOST', 'redis')}:{os.getenv('REDIS_PORT', '6379')}/0",
)
CACHE_TTL_SECONDS = int(os.getenv("TICKET_ANALYSIS_TTL_SECONDS", "604800"))
CACHE_PREFIX = "ai_support:ticket:"
redis_client: aioredis.Redis | None = None
engine = AISupportEngine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    await redis_client.ping()
    yield
    if redis_client is not None:
        await redis_client.aclose()


app = FastAPI(title="AI Support Engine", version="1.1.0", lifespan=lifespan)


class TicketAnalysisRequest(BaseModel):
    ticketId: int
    content: str
    userId: int
    userTier: Optional[str] = "free"
    totalPurchases: Optional[int] = 0


class TicketFeedbackRequest(BaseModel):
    ticketId: int
    rating: int
    comment: Optional[str] = None
    resolutionTime: Optional[int] = None
    ticketData: Optional[Dict] = None


def _cache_key(ticket_id: int) -> str:
    return f"{CACHE_PREFIX}{ticket_id}"


@app.post("/api/analyze")
async def analyze_ticket(request: TicketAnalysisRequest):
    try:
        result = engine.analyze_ticket(
            {
                "content": request.content,
                "userId": request.userId,
                "userTier": request.userTier,
                "totalPurchases": request.totalPurchases,
            }
        )
        if redis_client is None:
            raise HTTPException(503, "Ticket analysis storage is unavailable")
        record = {"ticketId": request.ticketId, "analysis": result}
        await redis_client.setex(
            _cache_key(request.ticketId), CACHE_TTL_SECONDS, json.dumps(record)
        )
        return record
    except HTTPException:
        raise
    except Exception:
        logger.exception("Ticket analysis failed")
        raise HTTPException(500, "Ticket analysis failed")


@app.get("/api/tickets/{ticket_id}/analysis")
async def get_ticket_analysis(ticket_id: int):
    if redis_client is None:
        raise HTTPException(503, "Ticket analysis storage is unavailable")
    cached = await redis_client.get(_cache_key(ticket_id))
    if not cached:
        raise HTTPException(
            404,
            "No cached analysis found. POST /api/analyze first.",
        )
    return json.loads(cached)


@app.post("/api/feedback")
async def ticket_feedback(
    feedback: TicketFeedbackRequest, background_tasks: BackgroundTasks
):
    background_tasks.add_task(
        engine.learn_from_feedback, feedback.ticketId, feedback.dict()
    )
    return {"status": "learning_started"}


@app.get("/api/seo-insights")
async def get_seo_insights(days: int = 30):
    return engine.get_seo_insights(days)


@app.get("/health")
async def health():
    redis_ok = False
    try:
        if redis_client is not None:
            await redis_client.ping()
            redis_ok = True
    except Exception:
        pass
    return {
        "status": "healthy" if redis_ok else "unavailable",
        "service": "ai_support",
        "timestamp": datetime.now().isoformat(),
        "redis": redis_ok,
    }


@app.get("/version")
async def version():
    return {"version": "1.1.0", "learning_rate": engine.learning_rate}
