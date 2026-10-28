import asyncio
import logging
import os
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.aeo_tracker import AEOVisibilityTracker

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AEO Visibility Tracker", version="2.0.0")
tracker = AEOVisibilityTracker()


class MentionRequest(BaseModel):
    brand: str = Field(..., min_length=1)
    prompts: List[str] = Field(..., min_items=1)
    persist: bool = True


@app.post("/check-mentions")
async def check_mentions(req: MentionRequest):
    try:
        results = await tracker.check_mentions(req.brand, req.prompts, req.persist)
        mention_rate = sum(1 for r in results if r.get("mentioned")) / len(results)
        return {
            "brand": req.brand,
            "mention_rate": round(mention_rate, 3),
            "results": results,
        }
    except Exception as exc:
        logger.error("check_mentions failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/history/{brand}")
async def get_history(brand: str):
    history = tracker.get_history(brand)
    if not history:
        raise HTTPException(404, "تاریخچه‌ای برای این برند ثبت نشده")
    return {"brand": brand, "history": history}


@app.get("/health")
async def health():
    redis_connected = False
    if tracker._redis is not None:
        try:
            redis_connected = bool(await asyncio.to_thread(tracker._redis.ping))
        except Exception:
            redis_connected = False

    provider_configured = bool(os.getenv("OPENAI_API_KEY"))
    if provider_configured and redis_connected:
        status, status_code = "healthy", 200
    elif provider_configured:
        # AEO requests can still run without Redis, but caching/history degrade.
        status, status_code = "degraded", 200
    else:
        status, status_code = "unavailable", 503

    payload = {
        "status": status,
        "service": "aeo_tracker",
        "provider": "openai",
        "provider_configured": provider_configured,
        "redis_connected": redis_connected,
    }
    return JSONResponse(content=payload, status_code=status_code)
