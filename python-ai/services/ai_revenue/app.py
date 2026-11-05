import logging
from datetime import datetime
from typing import Dict, List, Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from predictor import FEATURE_NAMES, RevenuePredictor

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Revenue Service", version="1.0.0")
predictor = RevenuePredictor()


FEATURE_REVISION = "revenue-features-v1"


class FeatureProvenance(BaseModel):
    status: Literal["observed", "derived", "missing"]
    source: Optional[str] = None
    asOf: Optional[str] = None
    window: Optional[str] = None
    units: Optional[str] = None
    transformation: Optional[str] = None
    revision: str


class LTVRequest(BaseModel):
    userId: int
    channelType: Optional[float] = None
    keywordDifficulty: Optional[float] = None
    contentLength: Optional[float] = None
    timeToConversion: Optional[float] = None
    cityWeight: Optional[float] = None
    intentScore: Optional[float] = None
    engagementDepth: Optional[float] = None
    retentionImpact: Optional[float] = None
    campaignCost: Optional[float] = None
    competitorPressure: Optional[float] = None
    seasonalityFactor: Optional[float] = None
    segmentSize: Optional[float] = None
    featureProvenance: Dict[str, FeatureProvenance] = Field(default_factory=dict)
    actualLtv: Optional[float] = None

    def missing_features(self) -> List[str]:
        missing: List[str] = []
        for name in FEATURE_NAMES:
            value = getattr(self, name, None)
            provenance = self.featureProvenance.get(name)
            if (
                value is None
                or provenance is None
                or provenance.status == "missing"
                or not provenance.source
                or not provenance.asOf
                or not provenance.units
                or not provenance.transformation
                or provenance.revision != FEATURE_REVISION
            ):
                missing.append(name)
        return missing

    def to_features(self) -> List[float]:
        missing = self.missing_features()
        if missing:
            raise ValueError("insufficient_data: " + ",".join(missing))
        return [
            float(self.channelType),
            float(self.keywordDifficulty),
            float(self.contentLength),
            min(float(self.timeToConversion) / 90, 1.0),
            float(self.cityWeight),
            float(self.intentScore),
            min(float(self.engagementDepth) / 20, 1.0),
            float(self.retentionImpact),
            min(float(self.campaignCost) / 1000, 1.0),
            float(self.competitorPressure),
            float(self.seasonalityFactor),
            min(float(self.segmentSize), 1.0),
        ]


@app.post("/predict/ltv")
async def predict_ltv(request: LTVRequest):
    missing = request.missing_features()
    if missing:
        raise HTTPException(
            422,
            detail={"code": "insufficient_data", "missing_features": missing},
        )
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

    incomplete = {index: item.missing_features() for index, item in enumerate(labeled)}
    incomplete = {index: fields for index, fields in incomplete.items() if fields}
    if incomplete:
        raise HTTPException(
            400,
            detail={"code": "insufficient_data", "incomplete_samples": incomplete},
        )

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
