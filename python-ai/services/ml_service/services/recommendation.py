import json
import logging
from typing import List, Dict, Optional
import numpy as np
from core.embedding_client import EmbeddingClient
from core.redis_client import redis_client
from core.config import settings

logger = logging.getLogger(__name__)


class RecommendationService:
    def __init__(self, embedding_client: EmbeddingClient, redis_client):
        self.embedding_client = embedding_client
        self.redis = redis_client

    async def _get_embeddings_batch(
        self, user_ids: List[int]
    ) -> Dict[int, Optional[list]]:
        if not user_ids:
            return {}

        keys = [f"emb:user:{uid}" for uid in user_ids]
        raw_values = await self.redis.mget(keys)

        result = {}
        for uid, raw in zip(user_ids, raw_values):
            result[uid] = json.loads(raw) if raw else None
        return result

    async def _get_revenue_signals_batch(self, user_ids: List[int]) -> Dict[int, float]:
        """Batch revenue signals"""
        if not user_ids:
            return {}
        keys = [f"revenue:potential:{uid}" for uid in user_ids]
        raw_values = await self.redis.mget(keys)

        result = {}
        for uid, raw in zip(user_ids, raw_values):
            result[uid] = float(raw) if raw else 0.35
        return result

    def _compute_similarities_vectorized(
        self, user_emb: list, candidate_embs: List[list]
    ) -> List[float]:
        if not candidate_embs:
            return []

        user_vec = np.array(user_emb, dtype=np.float32).reshape(1, -1)
        cand_matrix = np.array(candidate_embs, dtype=np.float32)

        user_norm = np.linalg.norm(user_vec)
        if user_norm == 0:
            return [0.0] * len(candidate_embs)

        norms = np.linalg.norm(cand_matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1e-10

        similarities = (cand_matrix @ user_vec.T).flatten() / (
            norms.flatten() * user_norm
        )
        return np.nan_to_num(similarities, nan=0.0).tolist()

    async def get_recommendations(
        self, user_id: int, candidate_ids: List[int], limit: int = None
    ):
        limit = min(limit or settings.DEFAULT_LIMIT, settings.MAX_LIMIT)
        if not candidate_ids:
            raise ValueError("candidates required")

        # Batch everything
        all_ids = list(set([user_id] + candidate_ids[: settings.MAX_CANDIDATES]))
        embeddings = await self._get_embeddings_batch(all_ids)
        revenue_signals = await self._get_revenue_signals_batch(all_ids)

        user_emb = embeddings.get(user_id)

        # === Cold Start واقعی ===
        if not user_emb:
            popular = await self._get_cold_start_recommendations(user_id, limit)
            return {
                "recommendations": popular[:limit],
                "cold_start": True,
                "fallback": "personalized_cold_start",
                "message": "Personalization warming up...",
            }

        # Vectorized processing
        candidate_ids = candidate_ids[: settings.MAX_CANDIDATES]
        candidate_embs = [
            embeddings[cid] for cid in candidate_ids if embeddings.get(cid)
        ]
        actual_cids = [cid for cid in candidate_ids if embeddings.get(cid)]

        if not candidate_embs:
            return {"recommendations": [], "cold_start": False}

        sim_scores = self._compute_similarities_vectorized(user_emb, candidate_embs)

        results = []
        for cid, sim in zip(actual_cids, sim_scores):
            revenue = revenue_signals.get(cid, 0.35)
            engagement = 0.5  # بعداً از cache user-event

            final_score = (
                settings.RECOMMENDATION_WEIGHTS["embedding"] * sim
                + settings.RECOMMENDATION_WEIGHTS["revenue"] * revenue
                + settings.RECOMMENDATION_WEIGHTS["engagement"] * engagement
            )

            results.append(
                {
                    "user_id": cid,
                    "score": round(final_score, 4),
                    "similarity": round(sim, 4),
                    "revenue_potential": round(revenue, 4),
                }
            )

        results.sort(key=lambda x: x["score"], reverse=True)
        return {
            "recommendations": results[:limit],
            "cold_start": False,
            "total_scored": len(results),
        }

    async def _get_popular_fallback(self) -> List[Dict]:
        """Fallback برای Cold Start"""
        raw = await self.redis.get(settings.POPULAR_USERS_KEY)
        if raw:
            return json.loads(raw)[:50]
        # Default fallback (بعداً cron job محبوب‌ها را آپدیت کند)
        return [
            {"user_id": i, "score": 0.85, "reason": "popular"} for i in range(1, 51)
        ]

    async def predict_match_score(self, user_a: int, user_b: int) -> float:
        embeddings = await self._get_embeddings_batch([user_a, user_b])
        emb_a = embeddings.get(user_a)
        emb_b = embeddings.get(user_b)
        if not emb_a or not emb_b:
            return 0.45
        return self._compute_similarities_vectorized(emb_a, [emb_b])[0]

    async def track_events(self, payload: dict):
        """Event tracking با Redis Stream"""
        try:
            await self.redis.xadd(
                "ml:training:events",
                {
                    "payload": json.dumps(payload),
                    "ts": str(__import__("datetime").datetime.utcnow()),
                },
                maxlen=100000,
                approximate=True,
            )
            logger.info(
                f"Tracked {len(payload.get('events', []))} events to Redis Stream"
            )
        except Exception as e:
            logger.error(f"Failed to track events: {e}")

    async def _get_cold_start_recommendations(
        self, user_id: int, limit: int
    ) -> List[Dict]:
        # 1. Same city / language / age (از Redis cache)
        # 2. Popular global
        # 3. High engagement

        # فعلاً ساده (بعداً با user metadata کامل می‌شود)
        popular = await self._get_popular_fallback()
        return popular[:limit]
