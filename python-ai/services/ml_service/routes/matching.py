import json
import logging
from typing import List, Optional, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.embedding_client import EmbeddingClient
from core.redis_client import redis_client
from core.config import settings
from services.recommendation import RecommendationService

logger = logging.getLogger(__name__)
router = APIRouter()

embedding_client = EmbeddingClient()
rec_service = RecommendationService(embedding_client, redis_client)


class EmbedIn(BaseModel):
    text: str = Field(..., min_length=1)
    user_id: Optional[int] = None


class RecommendIn(BaseModel):
    user_id: int
    candidates: List[int]
    limit: int = Field(settings.DEFAULT_LIMIT, ge=1, le=settings.MAX_LIMIT)


class PredictIn(BaseModel):
    user_a: int
    user_b: int


@router.post("/embed")
async def embed(payload: EmbedIn):
    # قبلاً text و user_id به‌صورت پارامتر ساده تعریف شده بودند که FastAPI
    # آن‌ها را query parameter در نظر می‌گیرد نه JSON body — یعنی سمت NestJS
    # باید با ?text=... صدا می‌زد، نه با body، که با بقیه‌ی endpointها ناهماهنگ بود.
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "text required")

    emb = await embedding_client.get_embedding(text)
    if emb is None:
        raise HTTPException(503, "Embedding service unavailable")

    if payload.user_id:
        ttl = settings.EMBEDDING_TTL_DAYS * 86400
        await redis_client.set(f"emb:user:{payload.user_id}", json.dumps(emb), ex=ttl)

    return {"embedding": emb, "model": "embedded_ai", "version": "v3"}


@router.post("/recommend")
async def recommend(payload: RecommendIn):
    result = await rec_service.get_recommendations(
        user_id=payload.user_id, candidate_ids=payload.candidates, limit=payload.limit
    )
    return result


@router.post("/predict")
async def predict_match(payload: PredictIn):
    score = await rec_service.predict_match_score(payload.user_a, payload.user_b)
    return {
        "score": round(score, 4),
        "user_a": payload.user_a,
        "user_b": payload.user_b,
    }


@router.post("/internal/track-events")
async def track_events(payload: dict):
    await rec_service.track_events(payload)
    return {"status": "accepted"}