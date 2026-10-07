import logging
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from conversion_trainer import ConversionTrainer

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Feedback Engine", version="2.0.0")
trainer = ConversionTrainer()


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
    value: Dict = {}
    metadata: Dict = {}
    createdAt: Optional[str] = None


@app.post("/feedback/train_incremental")
async def train_incremental(feedback: FeedbackRequest):
    try:
        result = trainer.train([feedback.dict()])
        return {
            "status": "ok",
            "trained": 1,
            "phase": result["phase"],
            "accuracy": result["accuracy"],
        }
    except Exception as exc:
        logger.error("Incremental training failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/feedback/train_batch")
async def train_batch(feedbacks: List[FeedbackRequest]):
    try:
        fb_list = [f.dict() for f in feedbacks]
        conversions = [1 if fb.get("convertedToPurchase") else 0 for fb in fb_list]
        revenues = [fb.get("revenue", 0) for fb in fb_list]
        result = trainer.train(fb_list, conversions, revenues)
        return {
            "status": "trained",
            "samples": len(feedbacks),
            "phase": result["phase"],
            "accuracy": result["accuracy"],
            "feature_importance": result.get("feature_importance", {}),
        }
    except Exception as exc:
        logger.error("Batch training failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/feedback/predict")
async def predict_conversion(feedback: FeedbackRequest):
    try:
        prediction = trainer.predict_conversion_probability(feedback.dict())
        return prediction
    except Exception as exc:
        logger.error("Prediction failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/feedback/metrics")
async def get_metrics():
    return {
        "feature_importance": trainer.get_feature_importance(),
        "model_phase": trainer.phase,
        "training_samples": trainer.training_count,
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_feedback",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
    }
