import logging
from datetime import datetime
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from predictor import RevenuePredictor

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Revenue Service", version="1.0.0")
predictor = RevenuePredictor()


class LTVRequest(BaseModel):
    userId: int
    channelType: float = 0.5
    keywordDifficulty: float = 0.5
    contentLength: float = 0.5
    timeToConversion: float = 30
    cityWeight: float = 0.5
    intentScore: float = 0.5
    engagementDepth: float = 5
    retentionImpact: float = 0.5
    campaignCost: float = 0
    competitorPressure: float = 0.3
    seasonalityFactor: float = 1.0
    segmentSize: float = 0.5
    # LTV واقعی — اگر برای training ارسال شود
    actualLtv: Optional[float] = None

    def to_features(self) -> List[float]:
        return [
            self.channelType,
            self.keywordDifficulty,
            self.contentLength,
            min(self.timeToConversion / 90, 1.0),
            self.cityWeight,
            self.intentScore,
            min(self.engagementDepth / 20, 1.0),
            self.retentionImpact,
            min(self.campaignCost / 1000, 1.0),
            self.competitorPressure,
            self.seasonalityFactor,
            min(self.segmentSize, 1.0),
        ]


@app.post("/predict/ltv")
async def predict_ltv(request: LTVRequest):
    try:
        result = predictor.predict_ltv(request.to_features())
        return {
            "userId": request.userId,
            **result,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as exc:
        logger.error("LTV prediction failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/train")
async def train_model(data: List[LTVRequest]):
    if not data:
        raise HTTPException(400, "No data provided")

    # فقط رکوردهایی که actualLtv دارند
    labeled = [item for item in data if item.actualLtv is not None]
    if not labeled:
        raise HTTPException(400, "No labeled data (actualLtv required for training)")

    try:
        X = np.array([item.to_features() for item in labeled])
        y = np.array([item.actualLtv for item in labeled])
        result = predictor.train_gb(X, y)
        return {"status": "trained", "samples": len(labeled), **result}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("Training failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_revenue",
        "model_trained": hasattr(predictor.gb_model, "estimators_"),
        "cv_score": predictor._cv_score,
        "timestamp": datetime.now().isoformat(),
    }
