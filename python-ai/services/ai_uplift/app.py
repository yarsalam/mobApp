import logging
from datetime import datetime
from typing import Dict, List

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from core.uplift_model import UpliftModel

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Uplift Modeling Service", version="1.0.0")
model = UpliftModel()


class TrainRequest(BaseModel):
    data: List[Dict]
    treatment_col: str = "treatment"
    outcome_col: str = "revenue"
    features: List[str] = Field(default_factory=list)


class PredictRequest(BaseModel):
    features: List[List[float]]


@app.post("/train")
async def train(req: TrainRequest):
    if not req.data:
        raise HTTPException(400, "data cannot be empty")
    if not req.features:
        raise HTTPException(400, "features list cannot be empty")
    try:
        df = pd.DataFrame(req.data)
        result = model.train(df, req.treatment_col, req.outcome_col, req.features)
        return result
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("Training failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.post("/predict-uplift")
async def predict_uplift(req: PredictRequest):
    if not req.features:
        raise HTTPException(400, "features cannot be empty")
    try:
        X = np.asarray(req.features, dtype=np.float32)
        if X.ndim != 2 or not np.isfinite(X).all():
            raise HTTPException(400, "features must be a finite 2D matrix")
        uplift = model.predict_uplift(X)
        return {
            "status": "ok",
            "uplift": uplift,
            "count": len(uplift),
            "effect_type": model._effect_type,
            "causal_claim": False,
            "causal_claim_reason": "Randomized assignment and causal identification are not verified by this API.",
            "confidence_interval": None,
            "interval_status": "not_calibrated",
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("Prediction failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    return {
        "status": "healthy" if model.trained else "degraded",
        "service": "ai_uplift",
        "model_trained": model.trained,
        "effect_type": model._effect_type,
        "causal_claim": False,
        "timestamp": datetime.now().isoformat(),
    }
