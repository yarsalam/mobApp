from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List

from core.link_graph import TrustFlowCalculator
from core.topic_relevance import TopicRelevance

app = FastAPI(title="Backlink Quality Analyzer")
tf_calc = TrustFlowCalculator()
topic_rel = TopicRelevance()


class TrustFlowRequest(BaseModel):
    edges: List[List[str]]
    trusted_seeds: List[str] = []


class TopicalRequest(BaseModel):
    source_text: str
    target_text: str


@app.post("/trust-flow")
async def trust_flow(req: TrustFlowRequest):
    try:
        scores = tf_calc.compute_trust_flow(req.edges, req.trusted_seeds)
        return scores
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.post("/topic-similarity")
async def topic_similarity(req: TopicalRequest):
    sim = await topic_rel.compute_similarity(req.source_text, req.target_text)
    return {"similarity": sim}


@app.get("/health")
async def health():
    return {"status": "ok"}
