import logging
from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from core.orchestrator import OpsOrchestrator
from storage.redis_client import RedisClient

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

orchestrator = OpsOrchestrator()
redis_client = RedisClient()


@asynccontextmanager
async def lifespan(app: FastAPI):
    orchestrator.start()
    yield
    orchestrator.stop()


app = FastAPI(title="AI Ops", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai_ops", "version": "2.0.0"}


@app.get("/metrics/latest")
async def get_latest_metrics():
    return {
        "system": redis_client.get_metric("latest:system"),
        "issues": redis_client.get_metric("latest:issues"),
        "revenue_issues": redis_client.get_metric("latest:revenue_issues"),
    }


@app.get("/issues")
async def get_issues():
    return {"issues": redis_client.get_metric("latest:issues") or []}


@app.post("/alerts/test")
async def test_alert():
    orchestrator._push_alert([{"type": "test", "severity": "warning"}])
    return {"status": "sent"}
