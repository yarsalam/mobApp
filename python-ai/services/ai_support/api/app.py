import logging
from datetime import datetime
from typing import Dict, Optional
 
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
 
from core.ticket_analyzer import AISupportEngine
 
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)
 
app = FastAPI(title="AI Support Engine", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
 
engine = AISupportEngine()
 
# ── in-memory analysis cache (replace with Redis in production) ────────────
_analysis_cache: Dict[int, Dict] = {}
 
class TicketAnalysisRequest(BaseModel):
    ticketId: int
    content: str
    userId: int
    userTier: Optional[str] = "free"
    totalPurchases: Optional[int] = 0
 
class TicketFeedbackRequest(BaseModel):
    ticketId: int
    rating: int
    comment: Optional[str] = None
    resolutionTime: Optional[int] = None
    ticketData: Optional[Dict] = None
 
# ── Endpoints ──────────────────────────────────────────────────────────────
 
@app.post("/api/analyze")
async def analyze_ticket(request: TicketAnalysisRequest):
    try:
        result = engine.analyze_ticket(
            {
                "content": request.content,
                "userId": request.userId,
                "userTier": request.userTier,
                "totalPurchases": request.totalPurchases,
            }
        )
        # Cache the result so GET /api/tickets/:id/analysis can serve it
        _analysis_cache[request.ticketId] = result
        return {"ticketId": request.ticketId, "analysis": result}
    except Exception as exc:
        logger.error("Analysis failed: %s", exc)
        raise HTTPException(500, str(exc))
 
@app.get("/api/tickets/{ticket_id}/analysis")
async def get_ticket_analysis(ticket_id: int):
    """Return cached analysis for a ticket."""
    cached = _analysis_cache.get(ticket_id)
    if not cached:
        raise HTTPException(
            404,
            "No cached analysis found. POST /api/analyze first.",
        )
    return {"ticketId": ticket_id, "analysis": cached}
 
@app.post("/api/feedback")
async def ticket_feedback(
    feedback: TicketFeedbackRequest, background_tasks: BackgroundTasks
):
    background_tasks.add_task(
        engine.learn_from_feedback, feedback.ticketId, feedback.dict()
    )
    return {"status": "learning_started"}
 
@app.get("/api/seo-insights")
async def get_seo_insights(days: int = 30):
    return engine.get_seo_insights(days)
 
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_support",
        "timestamp": datetime.now().isoformat(),
        "cache_size": len(_analysis_cache),
    }
 
@app.get("/version")
async def version():
    return {"version": "1.0.0", "learning_rate": engine.learning_rate}