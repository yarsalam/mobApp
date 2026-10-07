import logging
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from moderation_engine import ModerationEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Moderation Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = ModerationEngine()


class ModerateRequest(BaseModel):
    text: str
    context: Optional[str] = "message"
    user_id: Optional[int] = None


class ModerateBatchRequest(BaseModel):
    texts: List[str]
    context: Optional[str] = "message"


@app.post("/moderate")
async def moderate(req: ModerateRequest):
    try:
        result = await engine.moderate_text(req.text, req.context or "message")
        return {
            "user_id": req.user_id,
            "text_length": len(req.text),
            "context": req.context,
            **result,
            "checked_at": datetime.now().isoformat(),
        }
    except Exception as exc:
        logger.error("Moderation failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/moderate/batch")
async def moderate_batch(req: ModerateBatchRequest):
    try:
        results = await engine.moderate_batch(req.texts, req.context or "message")
        blocked = sum(1 for r in results if not r["allowed"])
        return {
            "total": len(req.texts),
            "blocked": blocked,
            "allowed": len(req.texts) - blocked,
            "results": results,
            "checked_at": datetime.now().isoformat(),
        }
    except Exception as exc:
        logger.error("Batch moderation failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_moderation",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
    }
