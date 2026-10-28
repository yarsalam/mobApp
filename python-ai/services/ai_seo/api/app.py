import logging
from datetime import datetime
from typing import Dict, List

from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.predictive.predictive_seo import PredictiveSEOEngine
from core.self_learning_engine import SelfLearningSEOEngine

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI SEO Service", version="1.0.0")

predictive_engine = PredictiveSEOEngine()
learning_engine = SelfLearningSEOEngine()


class TrafficRequest(BaseModel):
    historical_data: List[Dict]
    days: int = 90


@app.post("/predict/traffic")
async def predict_traffic(request: TrafficRequest):
    try:
        result = predictive_engine.forecast_traffic(
            request.historical_data, request.days
        )
        if result is None:
            raise HTTPException(
                400, "داده کافی برای پیش‌بینی وجود ندارد (حداقل ۱۴ روز)"
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Prediction failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/feedback/campaign")
async def campaign_feedback(payload: Dict = Body(...)):
    try:
        result = learning_engine.learn_from_data(payload)
        return {"status": "ok", **result}
    except Exception as exc:
        logger.error("Campaign feedback failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    redis_connected = False
    redis_client = getattr(learning_engine, "_redis", None)
    if redis_client is not None:
        try:
            redis_connected = bool(redis_client.ping())
        except Exception:
            redis_connected = False
    status = "healthy" if redis_connected else "degraded"
    payload = {
        "status": status,
        "service": "ai_seo",
        "redis_connected": redis_connected,
        "timestamp": datetime.now().isoformat(),
    }
    return JSONResponse(content=payload, status_code=200)


@app.get("/")
async def root():
    return {
        "name": "AI SEO Service",
        "version": "1.0.0",
        "endpoints": ["/health", "/predict/traffic", "/feedback/campaign"],
    }
