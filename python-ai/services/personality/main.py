import logging
from contextlib import asynccontextmanager
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

_models: Dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    loop = asyncio.get_event_loop()

    def _load():
        from transformers import pipeline

        _models["sentiment"] = pipeline("sentiment-analysis")
        _models["emotion"] = pipeline(
            "text-classification",
            model="j-hartmann/emotion-english-distilroberta-base",
        )
        logger.info("Personality models loaded")

    await loop.run_in_executor(None, _load)
    yield
    _models.clear()


app = FastAPI(
    title="Personality & Emotion Analysis", version="1.0.0", lifespan=lifespan
)


class Messages(BaseModel):
    messages: List[str]


def _run_pipeline(key: str, texts: List[str]) -> List[Dict]:
    model = _models.get(key)
    if model is None:
        raise RuntimeError(f"Model '{key}' not loaded")
    cleaned = [t[:512] for t in texts if t and t.strip()]
    if not cleaned:
        return []
    return model(cleaned)


@app.post("/analyze_sentiment")
async def analyze_sentiment(data: Messages):
    if not data.messages:
        raise HTTPException(400, "messages cannot be empty")
    try:
        results = _run_pipeline("sentiment", data.messages)
        return {"sentiments": results}
    except Exception as exc:
        logger.error("Sentiment analysis failed: %s", exc)
        raise HTTPException(503, "Model unavailable")


@app.post("/analyze_emotion")
async def analyze_emotion(data: Messages):
    if not data.messages:
        raise HTTPException(400, "messages cannot be empty")
    try:
        results = _run_pipeline("emotion", data.messages)
        return {"emotions": results}
    except Exception as exc:
        logger.error("Emotion analysis failed: %s", exc)
        raise HTTPException(503, "Model unavailable")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "personality",
        "models_loaded": list(_models.keys()),
    }
