from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

import joblib
import numpy as np
import redis.asyncio as aioredis
import xgboost as xgb
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.feature_builder import FeatureBuilder
from core.model_loader import ModelLoader

logger = logging.getLogger(__name__)
router = APIRouter()

model_loader = ModelLoader()
redis_client = aioredis.from_url(
    os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
)

FEEDBACK_KEY = "monetization:feedback"
FEEDBACK_SEEN_PREFIX = "monetization:feedback:seen:"
RETRAIN_LOCK_KEY = "monetization:retrain-lock"
MIN_RETRAIN_SAMPLES = 100
MIN_PER_CLASS = 10
MIN_PER_VARIANT = 10
MAX_FEEDBACK_ITEMS = 5000
FEEDBACK_ID_TTL_SECONDS = 90 * 24 * 60 * 60
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models") + "/promotion_model_v1.pkl"

STORE_FEEDBACK_LUA = """
if redis.call('SET', KEYS[2], '1', 'EX', ARGV[2], 'NX') then
  redis.call('LPUSH', KEYS[1], ARGV[1])
  redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[3]) - 1)
  return 1
end
return 0
"""

REMOVE_SNAPSHOT_LUA = """
local removed = 0
for i = 1, #ARGV do
  removed = removed + redis.call('LREM', KEYS[1], 1, ARGV[i])
end
return removed
"""

RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class PromotionRequest(BaseModel):
    user_id: int
    features: Dict[str, float] = Field(default_factory=dict)
    candidates: List[str]
    context: Dict[str, Any] = Field(default_factory=dict)
    feature_schema_version: int = FeatureBuilder.SCHEMA_VERSION


class FeedbackItem(BaseModel):
    user_id: int
    variant: str
    features: Dict[str, float] = Field(default_factory=dict)
    promotion_id: Optional[str] = None
    feedback_id: Optional[str] = None
    event_type: Literal[
        "shown", "click", "dismiss", "conversion", "non_conversion"
    ] = "dismiss"
    label: Optional[int] = None
    experiment_id: Optional[str] = None
    assignment_id: Optional[str] = None
    propensity: Optional[float] = None
    outcome_window_complete: bool = False
    context: Dict[str, Any] = Field(default_factory=dict)


class PromotionScore(BaseModel):
    variant: str
    score: float


class PromotionResponse(BaseModel):
    variant: str
    score: float
    all_scores: List[PromotionScore]
    score_kind: str
    model_status: str
    feature_schema_version: int


def _training_eligible(item: Dict[str, Any]) -> bool:
    event_type = item.get("event_type")
    label = item.get("label")
    propensity = item.get("propensity")
    has_randomized_assignment = bool(
        item.get("experiment_id") and item.get("assignment_id")
    )
    valid_propensity = (
        isinstance(propensity, (int, float))
        and np.isfinite(float(propensity))
        and 0.0 < float(propensity) <= 1.0
    )
    valid_outcome = (
        event_type == "conversion" and label == 1
    ) or (
        event_type == "non_conversion"
        and label == 0
        and item.get("outcome_window_complete") is True
    )
    return has_randomized_assignment and valid_propensity and valid_outcome


# ── prediction ────────────────────────────────────────────────────────────────


@router.post("/predict-promotion", response_model=PromotionResponse)
async def predict_promotion(request: PromotionRequest):
    if request.user_id <= 0:
        raise HTTPException(422, "user_id must be positive")
    if request.feature_schema_version != FeatureBuilder.SCHEMA_VERSION:
        raise HTTPException(
            422,
            {
                "code": "FEATURE_SCHEMA_MISMATCH",
                "expected": FeatureBuilder.SCHEMA_VERSION,
                "received": request.feature_schema_version,
            },
        )
    if not request.candidates:
        raise HTTPException(422, "At least one promotion candidate is required")

    try:
        variants = [FeatureBuilder.normalize_variant(v) for v in request.candidates]
        if len(set(variants)) != len(variants):
            raise ValueError("Promotion candidates must be unique")

        feature_vectors = np.vstack(
            [
                FeatureBuilder.build_features(request.features, variant)
                for variant in variants
            ]
        )
        scores, score_kind = model_loader.score_candidates(feature_vectors)
        results = sorted(
            [
                {"variant": variant, "score": float(score)}
                for variant, score in zip(variants, scores)
            ],
            key=lambda item: item["score"],
            reverse=True,
        )
        if not results or not all(np.isfinite(item["score"]) for item in results):
            raise ValueError("Scoring produced no finite candidate scores")

        status = model_loader.get_status()
        logger.info(
            "Promotion decision user=%d best=%s score=%.4f kind=%s",
            request.user_id,
            results[0]["variant"],
            results[0]["score"],
            score_kind,
        )
        return PromotionResponse(
            variant=results[0]["variant"],
            score=results[0]["score"],
            all_scores=results,
            score_kind=score_kind,
            model_status=status["model_status"],
            feature_schema_version=FeatureBuilder.SCHEMA_VERSION,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        logger.exception("predict_promotion failed")
        raise HTTPException(500, "Promotion scoring failed") from exc


# ── feedback event ingestion ──────────────────────────────────────────────────


@router.post("/feedback")
async def collect_feedback(feedback: FeedbackItem):
    if feedback.user_id <= 0:
        raise HTTPException(422, "user_id must be positive")
    try:
        variant = FeatureBuilder.normalize_variant(feedback.variant)
        if feedback.label not in (None, 0, 1):
            raise ValueError("label must be 0, 1, or null")
        if feedback.propensity is not None and (
            not np.isfinite(float(feedback.propensity))
            or not 0.0 < float(feedback.propensity) <= 1.0
        ):
            raise ValueError("propensity must be within (0, 1]")

        feedback_id = (feedback.feedback_id or str(uuid.uuid4())).strip()
        if not feedback_id or len(feedback_id) > 160:
            raise ValueError("feedback_id must contain 1-160 characters")

        item = feedback.dict()
        item["variant"] = variant
        item["feedback_id"] = feedback_id
        item["training_eligible"] = _training_eligible(item)
        item["received_at"] = datetime.now(timezone.utc).isoformat()
        raw = json.dumps(item, separators=(",", ":"), sort_keys=True, allow_nan=False)

        stored = await redis_client.eval(
            STORE_FEEDBACK_LUA,
            2,
            FEEDBACK_KEY,
            FEEDBACK_SEEN_PREFIX + feedback_id,
            raw,
            FEEDBACK_ID_TTL_SECONDS,
            MAX_FEEDBACK_ITEMS,
        )
        total = await redis_client.llen(FEEDBACK_KEY)
        return {
            "status": "stored" if stored else "duplicate",
            "feedback_id": feedback_id,
            "total_samples": total,
            "training_eligible": item["training_eligible"],
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        logger.exception("collect_feedback failed")
        raise HTTPException(503, "Feedback storage unavailable") from exc


@router.get("/feedback/count")
async def get_feedback_count():
    try:
        count = await redis_client.llen(FEEDBACK_KEY)
        return {"total": count, "training_minimum": MIN_RETRAIN_SAMPLES}
    except Exception as exc:
        raise HTTPException(503, "Feedback storage unavailable") from exc


# ── model retraining ──────────────────────────────────────────────────────────


@router.post("/retrain-from-feedback")
async def retrain_from_feedback():
    lock_token = str(uuid.uuid4())
    acquired = await redis_client.set(
        RETRAIN_LOCK_KEY, lock_token, ex=900, nx=True
    )
    if not acquired:
        raise HTTPException(409, "A promotion retraining job is already running")

    try:
        raw_snapshot = await redis_client.lrange(FEEDBACK_KEY, 0, -1)
        snapshot: List[Dict[str, Any]] = []
        raw_eligible: List[str] = []
        for raw in raw_snapshot:
            try:
                item = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if _training_eligible(item):
                snapshot.append(item)
                raw_eligible.append(raw)

        if len(snapshot) < MIN_RETRAIN_SAMPLES:
            raise HTTPException(
                400,
                {
                    "code": "NOT_ENOUGH_RANDOMIZED_OUTCOMES",
                    "eligible_samples": len(snapshot),
                    "required_samples": MIN_RETRAIN_SAMPLES,
                    "message": "Dismiss/click events and non-randomized labels are not training outcomes.",
                },
            )

        labels = np.asarray([int(item["label"]) for item in snapshot], dtype=np.int32)
        unique, counts = np.unique(labels, return_counts=True)
        class_counts = {int(label): int(count) for label, count in zip(unique, counts)}
        if set(class_counts) != {0, 1} or min(class_counts.values()) < MIN_PER_CLASS:
            raise HTTPException(
                400,
                {
                    "code": "INSUFFICIENT_CLASS_COVERAGE",
                    "class_counts": class_counts,
                    "minimum_per_class": MIN_PER_CLASS,
                },
            )

        variants = [FeatureBuilder.normalize_variant(item["variant"]) for item in snapshot]
        variant_counts = {v: variants.count(v) for v in FeatureBuilder.VARIANTS}
        if any(variant_counts[v] < MIN_PER_VARIANT for v in FeatureBuilder.VARIANTS):
            raise HTTPException(
                400,
                {
                    "code": "INSUFFICIENT_VARIANT_COVERAGE",
                    "variant_counts": variant_counts,
                    "minimum_per_variant": MIN_PER_VARIANT,
                },
            )

        X = np.vstack(
            [
                FeatureBuilder.build_features(item["features"], item["variant"])
                for item in snapshot
            ]
        )
        if X.shape[1] != len(FeatureBuilder.FEATURE_NAMES) or not np.isfinite(X).all():
            raise HTTPException(400, "Training feature matrix is invalid")

        model = xgb.XGBClassifier(
            n_estimators=120,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.85,
            colsample_bytree=0.85,
            random_state=42,
            n_jobs=1,
            eval_metric="logloss",
        )
        model.fit(X, labels)

        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        tmp_path = MODEL_PATH + f".{lock_token}.tmp"
        artifact = {
            "model": model,
            "feature_schema_version": FeatureBuilder.SCHEMA_VERSION,
            "feature_names": FeatureBuilder.get_feature_names(),
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "training_samples": int(len(labels)),
            "class_counts": class_counts,
            "variant_counts": variant_counts,
            "experiment_ids": sorted({item["experiment_id"] for item in snapshot}),
        }
        joblib.dump(artifact, tmp_path)
        os.replace(tmp_path, MODEL_PATH)

        # Remove only the exact events used by this successful training run.
        # New events pushed while fitting remain in the queue. If deletion
        # fails, training data is retained (at-least-once, never lossy).
        removed = await redis_client.eval(
            REMOVE_SNAPSHOT_LUA,
            1,
            FEEDBACK_KEY,
            *raw_eligible,
        )

        model_loader._model = model
        model_loader._status = "ready"
        model_loader._artifact_info = {
            "trained_at": artifact["trained_at"],
            "training_samples": artifact["training_samples"],
            "experiment_ids": artifact["experiment_ids"],
        }

        logger.info(
            "Promotion model trained samples=%d removed=%d",
            len(labels),
            int(removed),
        )
        return {
            "status": "retrained",
            "samples": int(len(labels)),
            "removed_feedback_events": int(removed),
            "remaining_feedback_events": await redis_client.llen(FEEDBACK_KEY),
            "model_status": "ready",
            "feature_schema_version": FeatureBuilder.SCHEMA_VERSION,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Promotion retraining failed; feedback queue preserved")
        raise HTTPException(500, "Promotion retraining failed; feedback was preserved") from exc
    finally:
        try:
            await redis_client.eval(RELEASE_LOCK_LUA, 1, RETRAIN_LOCK_KEY, lock_token)
        except Exception:
            logger.exception("Could not release promotion retraining lock")
