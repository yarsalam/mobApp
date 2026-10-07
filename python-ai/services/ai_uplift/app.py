import logging
from datetime import datetime
from typing import Dict, List

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

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
    features: List[str] = []


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
        X = np.array(req.features, dtype=np.float32)
        uplift = model.predict_uplift(X)
        return {"uplift": uplift, "count": len(uplift)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("Prediction failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_uplift",
        "model_trained": model.trained,
        "timestamp": datetime.now().isoformat(),
    }
