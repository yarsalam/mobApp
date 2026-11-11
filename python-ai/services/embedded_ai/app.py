import logging
import os
from contextlib import asynccontextmanager
from typing import List

import numpy as np
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)

MODEL_NAME = os.getenv(
    "MODEL_NAME", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
MODEL_REVISION = os.getenv("MODEL_REVISION") or None
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

model: SentenceTransformer = None
redis_client: aioredis.Redis = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, redis_client
    logger.info(
        "Loading embedding model %s (revision=%s)",
        MODEL_NAME,
        MODEL_REVISION or "default",
    )
    # On first Staging start, sentence-transformers downloads the public model
    # into HF_HOME. In Codespaces the HF_HOME path is backed by a named volume,
    # so subsequent starts reuse the verified model without another download.
    model = SentenceTransformer(MODEL_NAME, revision=MODEL_REVISION)
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    logger.info(
        "Embedding hub started; model loaded: %s; dimension=%s",
        MODEL_NAME,
        model.get_sentence_embedding_dimension(),
    )
    yield
    await redis_client.aclose()
    logger.info("Embedding hub stopped")


app = FastAPI(title="Embedding Hub Service", version="3.1.0", lifespan=lifespan)


class TextInput(BaseModel):
    text: str


class BatchTextInput(BaseModel):
    texts: List[str]


class CompareVectorsInput(BaseModel):
    vector_a: List[float]
    vector_b: List[float]


@app.post("/embed")
async def get_embedding(data: TextInput):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="متن ورودی نمی‌تواند خالی باشد")
    embedding: List[float] = model.encode(text).tolist()
    return {
        "embedding": embedding,
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "dimension": len(embedding),
    }


@app.post("/embed/batch")
async def get_batch_embeddings(data: BatchTextInput):
    if not data.texts:
        raise HTTPException(status_code=400, detail="لیست متون نمی‌تواند خالی باشد")
    cleaned = [t.strip() for t in data.texts if t.strip()]
    if not cleaned:
        raise HTTPException(status_code=400, detail="همه متون خالی هستند")
    embeddings: List[List[float]] = model.encode(cleaned).tolist()
    return {
        "embeddings": embeddings,
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "dimension": len(embeddings[0]),
    }


@app.post("/similarity")
async def compute_similarity(data: CompareVectorsInput):
    a = np.array(data.vector_a, dtype=np.float32)
    b = np.array(data.vector_b, dtype=np.float32)
    if a.ndim != 1 or b.ndim != 1 or a.shape != b.shape:
        raise HTTPException(status_code=422, detail="Vectors must be 1D and have equal dimensions")
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return {"similarity": 0.0}
    similarity = float(np.dot(a, b) / (norm_a * norm_b))
    if not np.isfinite(similarity):
        raise HTTPException(status_code=422, detail="Similarity is not finite")
    return {"similarity": similarity}


@app.get("/health")
async def health():
    redis_ok = False
    try:
        await redis_client.ping()
        redis_ok = True
    except Exception:
        pass
    return {
        "status": "healthy" if model is not None and redis_ok else "degraded",
        "service": "embedding_hub",
        "model_loaded": model is not None,
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "dimension": model.get_sentence_embedding_dimension() if model is not None else None,
        "redis": redis_ok,
    }
