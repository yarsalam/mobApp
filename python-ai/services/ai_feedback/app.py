import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Feedback Engine", version="2.1.0")


class FeedbackRequest(BaseModel):
    userId: int
    feature: str
    phase: Optional[int] = None
    feedbackType: Optional[str] = None
    sentiment: Optional[str] = None
    sentimentScore: Optional[float] = None
    impactScore: Optional[float] = None
    revenueImpact: Optional[float] = None
    seoImpact: Optional[float] = None
    convertedToPurchase: Optional[bool] = None
    value: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    createdAt: Optional[str] = None


class FeedbackEnvelope(BaseModel):
    feedback: FeedbackRequest


def _normalise_feedback(payload: Union[FeedbackRequest, FeedbackEnvelope]) -> FeedbackRequest:
    return payload.feedback if isinstance(payload, FeedbackEnvelope) else payload


@app.post("/feedback/train_incremental")
async def train_incremental(payload: Union[FeedbackRequest, FeedbackEnvelope]):
    # A single feedback event is not a conversion outcome. In particular, a missing
    # conversion label must never be silently converted to a negative training label.
    feedback = _normalise_feedback(payload)
    return {
        "status": "accepted_not_trained",
        "trained": 0,
        "training_enabled": False,
        "reason": "matured_conversion_outcome_dataset_not_available",
        "feature": feedback.feature,
    }


@app.post("/feedback/train_batch")
async def train_batch(feedbacks: List[FeedbackRequest]):
    # The current producer does not provide a matured positive AND negative label
    # contract. Keep training disabled rather than learning from default-false labels.
    return {
        "status": "not_trained",
        "trained": 0,
        "samples_received": len(feedbacks),
        "training_enabled": False,
        "reason": "matured_conversion_outcome_dataset_not_available",
    }


@app.post("/feedback/predict")
async def predict_conversion(payload: Union[FeedbackRequest, FeedbackEnvelope]):
    _normalise_feedback(payload)
    raise HTTPException(
        status_code=503,
        detail={
            "status": "unavailable",
            "probability": None,
            "confidence": None,
            "reason": "no_validated_conversion_model",
        },
    )


@app.get("/feedback/metrics")
async def get_metrics():
    return {
        "feature_importance": {},
        "model_phase": None,
        "training_samples": 0,
        "model_available": False,
        "model_trained": False,
        "training_enabled": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_feedback",
        "version": "2.1.0",
        "model_available": False,
        "training_enabled": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
