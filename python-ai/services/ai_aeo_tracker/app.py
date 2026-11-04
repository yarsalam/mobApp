import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.aeo_tracker import AEOVisibilityTracker
from core.providers import PerplexityProvider

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AEO Visibility Tracker", version="2.1.0")
tracker = AEOVisibilityTracker()
perplexity_tracker = AEOVisibilityTracker(
    provider=PerplexityProvider(),
    redis_client=tracker._redis,
)
engine_trackers = {
    "openai": tracker,
    "perplexity": perplexity_tracker,
}


class MentionRequest(BaseModel):
    brand: str = Field(..., min_length=1, max_length=200)
    prompts: List[str] = Field(..., min_items=1, max_items=50)
    engines: List[str] | None = Field(default=None, max_items=4)
    persist: bool = True


def _provider_configured(engine: str) -> bool:
    if engine == "openai":
        return bool(os.getenv("OPENAI_API_KEY"))
    if engine == "perplexity":
        return bool(os.getenv("PERPLEXITY_API_KEY"))
    return False


def _unavailable_result(brand: str, prompt: str, engine: str, error_code: str) -> dict:
    return {
        "brand": brand,
        "prompt": prompt,
        "engine": engine,
        "status": "unavailable",
        "mentioned": None,
        "sentiment": "unknown",
        "citations": [],
        "error_code": error_code,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/check-mentions")
async def check_mentions(req: MentionRequest):
    if req.engines is None:
        engines = [
            name for name in engine_trackers
            if _provider_configured(name)
        ] or ["openai"]
    else:
        engines = list(dict.fromkeys(req.engines))
    if not engines:
        raise HTTPException(422, "Select at least one AEO engine")

    results = []
    for engine in engines:
        engine_tracker = engine_trackers.get(engine)
        if engine_tracker is None:
            results.extend(
                _unavailable_result(req.brand, prompt, engine, "provider_not_supported")
                for prompt in req.prompts
            )
            continue
        if not _provider_configured(engine):
            results.extend(
                _unavailable_result(req.brand, prompt, engine, "provider_not_configured")
                for prompt in req.prompts
            )
            continue
        try:
            engine_results = await engine_tracker.check_mentions(
                req.brand, req.prompts, req.persist
            )
            results.extend(engine_results)
        except Exception as exc:
            logger.error("AEO check failed for engine %s: %s", engine, exc)
            results.extend(
                _unavailable_result(req.brand, prompt, engine, "provider_unavailable")
                for prompt in req.prompts
            )

    summaries = {}
    for engine in engines:
        subset = [result for result in results if result.get("engine") == engine]
        available = [
            result for result in subset
            if result.get("status") == "ok" and isinstance(result.get("mentioned"), bool)
        ]
        unavailable_count = len(subset) - len(available)
        summaries[engine] = {
            "status": "unavailable" if not available else ("partial" if unavailable_count else "ok"),
            "sample_count": len(subset),
            "available_count": len(available),
            "unavailable_count": unavailable_count,
            "mention_rate": (
                round(sum(1 for result in available if result.get("mentioned")) / len(available), 3)
                if available else None
            ),
        }

    available_count = sum(item["available_count"] for item in summaries.values())
    unavailable_count = sum(item["unavailable_count"] for item in summaries.values())
    sample_count = sum(item["sample_count"] for item in summaries.values())
    status = "unavailable" if not available_count else ("partial" if unavailable_count else "ok")
    payload = {
        "brand": req.brand,
        "status": status,
        "engines": engines,
        "sample_count": sample_count,
        "available_count": available_count,
        "unavailable_count": unavailable_count,
        # Never combine rates from different engines into one misleading score.
        "mention_rate": summaries[engines[0]]["mention_rate"] if len(engines) == 1 else None,
        "mention_rate_by_engine": summaries,
        "results": results,
    }
    if not available_count:
        return JSONResponse(content=payload, status_code=503)
    return payload


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

    providers = {
        "openai": _provider_configured("openai"),
        "perplexity": _provider_configured("perplexity"),
    }
    any_provider_configured = any(providers.values())
    if any_provider_configured and redis_connected:
        status, status_code = "healthy", 200
    elif any_provider_configured:
        # AEO requests can still run without Redis, but caching/history degrade.
        status, status_code = "degraded", 200
    else:
        status, status_code = "unavailable", 503

    payload = {
        "status": status,
        "service": "aeo_tracker",
        "provider": "multi" if sum(providers.values()) > 1 else next(
            (name for name, configured in providers.items() if configured), None
        ),
        "providers": providers,
        "redis_connected": redis_connected,
    }
    return JSONResponse(content=payload, status_code=status_code)
