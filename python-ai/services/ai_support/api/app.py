import json
import logging
import os
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import redis.asyncio as aioredis
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
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
ANALYTICS_TTL_SECONDS = int(os.getenv("TICKET_ANALYTICS_TTL_SECONDS", str(180 * 86400)))
CACHE_PREFIX = "ai_support:ticket:"
ANALYTICS_PREFIX = "ai_support:analytics:"
ANALYTICS_INDEX_KEY = "ai_support:analytics:index"
redis_client: aioredis.Redis | None = None
engine = AISupportEngine()

CATEGORY_LABELS = {
    "technical": "مشکلات فنی",
    "billing": "پرداخت و مالی",
    "account": "حساب کاربری",
    "feature_request": "درخواست قابلیت",
    "report": "گزارش و ایمنی",
    "other": "سایر",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    await redis_client.ping()
    yield
    if redis_client is not None:
        await redis_client.aclose()


app = FastAPI(title="AI Support Engine", version="1.2.0", lifespan=lifespan)


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


def _analytics_key(ticket_id: int) -> str:
    return f"{ANALYTICS_PREFIX}{ticket_id}"


async def _read_analytics(ticket_ids: list[str]) -> list[dict]:
    if redis_client is None or not ticket_ids:
        return []
    raw_records = await redis_client.mget([_analytics_key(int(ticket_id)) for ticket_id in ticket_ids])
    records = []
    for raw in raw_records:
        if not raw:
            continue
        try:
            record = json.loads(raw)
            if isinstance(record, dict):
                records.append(record)
        except (TypeError, ValueError):
            logger.warning("Ignoring malformed ticket analytics record")
    return records


def _count_categories(records: list[dict]) -> Counter:
    return Counter(
        str(record.get("category", "other"))
        for record in records
        if record.get("category")
    )


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

        now = datetime.now(timezone.utc)
        ticket_id = request.ticketId
        record = {
            "ticketId": ticket_id,
            "analysis": result,
            "created_at": now.isoformat(),
        }
        # Short-lived cache can serve the support UI. Analytics retains only
        # non-identifying aggregates; neither raw ticket text nor userId is stored.
        await redis_client.setex(_cache_key(ticket_id), CACHE_TTL_SECONDS, json.dumps(record))
        analytics_record = {
            "ticketId": ticket_id,
            "created_at": now.isoformat(),
            "category": result.get("suggested_category", "other"),
            "priority": result.get("suggested_priority", "medium"),
            "sentiment": (result.get("sentiment") or {}).get("label", "unknown"),
            "keywords": (result.get("keywords") or [])[:20],
        }
        await redis_client.setex(
            _analytics_key(ticket_id), ANALYTICS_TTL_SECONDS, json.dumps(analytics_record)
        )
        await redis_client.zadd(ANALYTICS_INDEX_KEY, {str(ticket_id): now.timestamp()})
        await redis_client.expire(ANALYTICS_INDEX_KEY, ANALYTICS_TTL_SECONDS)
        # Bound the sorted-set index to the retention window.
        cutoff = (now - timedelta(seconds=ANALYTICS_TTL_SECONDS)).timestamp()
        await redis_client.zremrangebyscore(ANALYTICS_INDEX_KEY, "-inf", cutoff)
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
        raise HTTPException(404, "No cached analysis found. POST /api/analyze first.")
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
async def get_seo_insights(days: int = Query(default=30, ge=1, le=180)):
    if redis_client is None:
        raise HTTPException(503, "Ticket analytics storage is unavailable")
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    previous_start = start - timedelta(days=days)

    current_ids = await redis_client.zrangebyscore(
        ANALYTICS_INDEX_KEY, start.timestamp(), now.timestamp()
    )
    previous_ids = await redis_client.zrangebyscore(
        ANALYTICS_INDEX_KEY, previous_start.timestamp(), start.timestamp() - 0.001
    )
    current = await _read_analytics(current_ids)
    previous = await _read_analytics(previous_ids)
    current_categories = _count_categories(current)
    previous_categories = _count_categories(previous)

    top_issues = []
    for category, count in current_categories.most_common():
        prior = previous_categories.get(category, 0)
        trend = None if prior == 0 else round((count - prior) * 100.0 / prior, 1)
        top_issues.append({
            "category": category,
            "issue": CATEGORY_LABELS.get(category, CATEGORY_LABELS["other"]),
            "count": count,
            "previous_period_count": prior,
            "trend_percent": trend,
        })

    sentiment_counts = Counter(str(record.get("sentiment", "unknown")) for record in current)
    total_sentiment = sum(sentiment_counts.values())
    sentiment_share = {
        label: round(count * 100.0 / total_sentiment, 1)
        for label, count in sentiment_counts.items()
    } if total_sentiment else {}

    feature_keywords = Counter(
        str(keyword)
        for record in current if record.get("category") == "feature_request"
        for keyword in record.get("keywords", [])
        if keyword
    )
    feature_requests = [
        {"feature_keyword": word, "requests": count}
        for word, count in feature_keywords.most_common(10)
    ]

    return {
        "status": "ok" if current else "insufficient_data",
        "data_source": "retained_ticket_analysis_records",
        "period_days": days,
        "sample_count": len(current),
        "comparison_sample_count": len(previous),
        "top_issues": top_issues,
        "user_sentiment_trend_percent": sentiment_share,
        "feature_requests": feature_requests,
        "note": "Only retained analyzed tickets are counted. Trends are omitted when the previous period has no samples.",
    }


@app.get("/health")
async def health():
    redis_ok = False
    try:
        if redis_client is not None:
            await redis_client.ping()
            redis_ok = True
    except Exception:
        pass
    payload = {
        "status": "healthy" if redis_ok else "unavailable",
        "service": "ai_support",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "redis": redis_ok,
    }
    from fastapi.responses import JSONResponse
    return JSONResponse(content=payload, status_code=200 if redis_ok else 503)


@app.get("/version")
async def version():
    return {"version": "1.2.0", "learning_rate": engine.learning_rate}
