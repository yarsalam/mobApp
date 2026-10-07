import logging
from typing import List

from fastapi import FastAPI, HTTPException
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
    return {"status": "ok", "redis_connected": tracker._redis is not None}
