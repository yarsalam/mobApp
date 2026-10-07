import logging
import os
from typing import Dict, List

import httpx

logger = logging.getLogger(__name__)

EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://embedded_ai:8100")

TRAIT_PROMPTS: Dict[str, str] = {
    "openness": "I like traveling, exploring new ideas, and art. I enjoy creativity and learning.",
    "conscientiousness": "I am organized and like to plan things ahead. I try to be responsible.",
    "extraversion": "I enjoy being social and meeting new people. I like parties and friends.",
    "agreeableness": "I like helping others and being kind. I am friendly and cooperative.",
    "neuroticism": "I often feel anxious and worry a lot. I get stressed easily.",
}

KEYWORD_MAP: Dict[str, List[str]] = {
    "openness": ["creative", "curious", "art", "travel", "explore", "learn"],
    "conscientiousness": ["organized", "plan", "responsible", "goal", "career"],
    "extraversion": ["social", "party", "friends", "outgoing"],
    "agreeableness": ["kind", "help", "support", "friendly"],
    "neuroticism": ["anxious", "worry", "stress", "moody"],
}

# Sentiment pipeline — optional, loaded lazily
_sentiment_pipeline = None


def _get_sentiment_pipeline():
    global _sentiment_pipeline
    if _sentiment_pipeline is None:
        try:
            from transformers import pipeline as hf_pipeline

            _sentiment_pipeline = hf_pipeline(
                "sentiment-analysis", model="distilbert-base-uncased"
            )
        except Exception as exc:
            logger.warning("Sentiment model not available: %s", exc)
            _sentiment_pipeline = False  # mark as unavailable
    return _sentiment_pipeline if _sentiment_pipeline else None


# ── public API ────────────────────────────────────────────────────────────────


async def analyze_personality(text: str) -> Dict[str, float]:
    text = (text or "").strip()
    if not text:
        return {t: 0.5 for t in TRAIT_PROMPTS}
    try:
        user_emb = await _get_embedding(text)
        scores: Dict[str, float] = {}
        for trait, prompt in TRAIT_PROMPTS.items():
            prompt_emb = await _get_embedding(prompt)
            sim = await _compute_similarity(user_emb, prompt_emb)
            scores[trait] = round(max(0.0, min(1.0, (sim + 1) / 2 * 0.9 + 0.05)), 2)
        return scores
    except Exception as exc:
        logger.exception(
            "Personality analysis failed, falling back to rule-based: %s", exc
        )
        return _rule_based_personality(text)


def sentiment_of_text(text: str) -> Dict:
    if not text:
        return {"label": "neutral", "score": 0.0}
    pipeline = _get_sentiment_pipeline()
    if pipeline is None:
        return {"label": "neutral", "score": 0.0}
    try:
        out = pipeline(text[:512])
        if isinstance(out, list) and out:
            return {"label": out[0]["label"], "score": float(out[0].get("score", 0.0))}
    except Exception as exc:
        logger.exception("Sentiment pipeline failed: %s", exc)
    return {"label": "neutral", "score": 0.0}


# ── private helpers ───────────────────────────────────────────────────────────


async def _get_embedding(text: str) -> List[float]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{EMBEDDING_SERVICE_URL}/embed", json={"text": text})
        resp.raise_for_status()
        return resp.json()["embedding"]


async def _compute_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{EMBEDDING_SERVICE_URL}/similarity",
                json={"vector_a": vec_a, "vector_b": vec_b},
            )
            resp.raise_for_status()
            return resp.json()["similarity"]
    except Exception as exc:
        logger.error("Similarity computation failed: %s", exc)
        return 0.0


def _rule_based_personality(text: str) -> Dict[str, float]:
    text_low = text.lower()
    return {
        trait: round(min(1.0, 0.3 + 0.18 * sum(1 for k in keys if k in text_low)), 2)
        for trait, keys in KEYWORD_MAP.items()
    }
