import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.feature_builder import FeatureBuilder
from core.model_loader import ModelLoader
from routes.promotion import router as promotion_router

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)
model_loader = ModelLoader()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AI Monetization started")
    yield
    logger.info("AI Monetization stopped")


app = FastAPI(
    title="AI Monetization Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(promotion_router, prefix="/api", tags=["promotion"])


@app.get("/health")
async def health():
    model = model_loader.get_status()
    return {
        "status": "healthy",
        "service": "ai_monetization",
        "version": "1.0.0",
        "model_status": model["model_status"],
        "model_available": model["model_available"],
        "feature_schema_version": FeatureBuilder.SCHEMA_VERSION,
    }


@app.get("/version")
async def version():
    return {
        "model_version": os.getenv("MODEL_VERSION", "v1"),
        "model_path": os.getenv("MODEL_PATH", "/app/models"),
        **model_loader.get_status(),
    }
