import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from routes.matching import router as matching_router

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 ML Matching Service started")
    # TODO: warmup cache یا health check embedded_ai
    yield
    logger.info("🛑 ML Matching Service stopped")


app = FastAPI(title="ML Matching Service", version="2.0.0", lifespan=lifespan)

app.include_router(matching_router, prefix="/api", tags=["matching"])


@app.get("/health")
def health():
    return {"status": "healthy", "service": "ml_matching_v2"}
