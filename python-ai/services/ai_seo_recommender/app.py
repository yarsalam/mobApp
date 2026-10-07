import logging
from datetime import datetime
from typing import List, Tuple

from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core.cf_model import SEOCollaborativeFilter

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="SEO Recommender", version="1.0.0")
cf = SEOCollaborativeFilter()


class TrainRequest(BaseModel):
    interactions: List[Tuple[str, str, float]]


class RecommendRequest(BaseModel):
    user_id: str
    n: int = 5


def _do_train(interactions: List[Tuple[str, str, float]]) -> None:
    try:
        result = cf.train(interactions)
        logger.info("Training complete: %s", result)
    except Exception as exc:
        logger.error("Background training failed: %s", exc)


@app.post("/train")
async def train(req: TrainRequest, background_tasks: BackgroundTasks):
    if not req.interactions:
        raise HTTPException(400, "interactions cannot be empty")
    background_tasks.add_task(_do_train, req.interactions)
    return {"status": "training_started", "interactions": len(req.interactions)}


@app.post("/recommend")
async def recommend(req: RecommendRequest):
    try:
        recs = cf.recommend(req.user_id, req.n)
        return {"user_id": req.user_id, "recommendations": recs}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error("Recommendation failed: %s", exc)
        raise HTTPException(500, str(exc))


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_seo_recommender",
        "model_trained": cf.trained,
        "popular_items_count": len(cf._popular_items),
        "timestamp": datetime.now().isoformat(),
    }
