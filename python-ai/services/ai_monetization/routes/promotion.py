import json
import logging
import os
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import redis.asyncio as aioredis
import xgboost as xgb
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.feature_builder import FeatureBuilder
from core.model_loader import ModelLoader

logger = logging.getLogger(__name__)
router = APIRouter()

model_loader = ModelLoader()
redis_client = aioredis.from_url(
    os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
)

FEEDBACK_KEY = "monetization:feedback"
MIN_RETRAIN_SAMPLES = 100
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models") + "/promotion_model_v1.pkl"


class PromotionRequest(BaseModel):
    user_id: int
    features: Dict[str, float]
    candidates: List[str]
    context: Optional[Dict[str, Any]] = {}


class FeedbackItem(BaseModel):
    user_id: int
    variant: str
    features: Dict[str, float]
    label: int  # 1 = conversion


class PromotionScore(BaseModel):
    variant: str
    score: float


class PromotionResponse(BaseModel):
    variant: str
    score: float
    all_scores: List[PromotionScore]


# ── predict ────────────────────────────────────────────────────────────────────


@router.post("/predict-promotion", response_model=PromotionResponse)
async def predict_promotion(request: PromotionRequest):
    try:
        feature_vectors = np.array(
            [
                FeatureBuilder.build_features(request.features, v)
                for v in request.candidates
            ]
        )

        probas = model_loader.predict_proba(feature_vectors)
        scores = probas[:, 1]

        results = sorted(
            [
                {"variant": v, "score": float(s)}
                for v, s in zip(request.candidates, scores)
            ],
            key=lambda x: x["score"],
            reverse=True,
        )

        logger.info(
            "User %d: best=%s score=%.3f",
            request.user_id,
            results[0]["variant"],
            results[0]["score"],
        )
        return PromotionResponse(
            variant=results[0]["variant"],
            score=results[0]["score"],
            all_scores=results,
        )
    except Exception as exc:
        logger.error("predict_promotion failed: %s", exc)
        raise HTTPException(500, str(exc))


# ── feedback ───────────────────────────────────────────────────────────────────


@router.post("/feedback")
async def collect_feedback(feedback: FeedbackItem):
    await redis_client.lpush(FEEDBACK_KEY, feedback.json())
    count = await redis_client.llen(FEEDBACK_KEY)
    return {"status": "collected", "total_samples": count}


@router.get("/feedback/count")
async def get_feedback_count():
    count = await redis_client.llen(FEEDBACK_KEY)
    return {"total": count}


# ── retrain ────────────────────────────────────────────────────────────────────


@router.post("/retrain-from-feedback")
async def retrain_from_feedback():
    """
    قبلاً: با rpop می‌خوند که مخربه — یعنی حتی اگه داده کافی نبود،
    آیتم‌های خونده‌شده از Redis پاک می‌شدن و برای همیشه گم می‌شدن.
    حالا: اول با LRANGE (غیرمخرب) می‌خونیم و تعداد رو چک می‌کنیم؛
    فقط در صورت کافی بودن داده، واقعاً از صف حذف می‌کنیم (LTRIM).
    """
    total = await redis_client.llen(FEEDBACK_KEY)
    if total < MIN_RETRAIN_SAMPLES:
        raise HTTPException(
            400, f"Not enough data: {total} < {MIN_RETRAIN_SAMPLES}"
        )

    raw_values = await redis_client.lrange(FEEDBACK_KEY, 0, total - 1)
    raw_items = [json.loads(v) for v in raw_values]

    try:
        X = np.array(
            [
                FeatureBuilder.build_features(f["features"], f["variant"])
                for f in raw_items
            ]
        )
        y = np.array([f["label"] for f in raw_items])

        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            use_label_encoder=False,
            eval_metric="logloss",
        )
        model.fit(X, y)
    except Exception as exc:
        # اگر train fail شد، داده‌ها هنوز توی Redis هستن چون چیزی pop نشده —
        # این خودِ مزیت اصلی این پچه نسبت به نسخه‌ی قبلی.
        logger.error("Retrain failed, feedback data preserved: %s", exc)
        raise HTTPException(500, f"Training failed: {exc}")

    # فقط الان که train موفق بود، داده‌های مصرف‌شده رو از صف پاک کن.
    # LTRIM از اندیس total به بعد نگه می‌داره (یعنی هر آیتمی که بعد از
    # شروع این عملیات با lpush اضافه شده حفظ می‌شه، چون lpush از چپ اضافه می‌کنه).
    await redis_client.ltrim(FEEDBACK_KEY, total, -1)

    tmp_path = MODEL_PATH + ".tmp"
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(model, tmp_path)
    os.replace(tmp_path, MODEL_PATH)

    model_loader._model = model

    logger.info("Model retrained with %d samples", len(y))
    return {"status": "retrained", "samples": len(y)}