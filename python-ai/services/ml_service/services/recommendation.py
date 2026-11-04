import json
import logging
import math
from typing import Dict, List, Optional

import numpy as np

from core.config import settings
from core.embedding_client import EmbeddingClient

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
        result: Dict[int, Optional[list]] = {}
        for uid, raw in zip(user_ids, raw_values):
            try:
                result[uid] = json.loads(raw) if raw else None
            except (TypeError, ValueError, json.JSONDecodeError):
                logger.warning("Ignoring malformed cached embedding for entity %s", uid)
                result[uid] = None
        return result

    async def _get_revenue_signals_batch(
        self, user_ids: List[int]
    ) -> Dict[int, Optional[float]]:
        """Return only observed, finite revenue signals; missing is not a score."""
        if not user_ids:
            return {}
        keys = [f"revenue:potential:{uid}" for uid in user_ids]
        raw_values = await self.redis.mget(keys)

        result: Dict[int, Optional[float]] = {}
        for uid, raw in zip(user_ids, raw_values):
            if raw is None:
                result[uid] = None
                continue
            try:
                value = float(raw)
            except (TypeError, ValueError):
                result[uid] = None
                continue
            result[uid] = value if math.isfinite(value) and 0.0 <= value <= 1.0 else None
        return result

    def _compute_similarities_vectorized(
        self, user_emb: list, candidate_embs: List[list]
    ) -> List[Optional[float]]:
        if not candidate_embs:
            return []

        try:
            user_vec = np.asarray(user_emb, dtype=np.float32).reshape(1, -1)
            cand_matrix = np.asarray(candidate_embs, dtype=np.float32)
            if cand_matrix.ndim != 2 or cand_matrix.shape[1] != user_vec.shape[1]:
                return [None] * len(candidate_embs)
            if not np.isfinite(user_vec).all() or not np.isfinite(cand_matrix).all():
                return [None] * len(candidate_embs)
        except (TypeError, ValueError):
            return [None] * len(candidate_embs)

        user_norm = float(np.linalg.norm(user_vec))
        if not math.isfinite(user_norm) or user_norm <= 0:
            return [None] * len(candidate_embs)

        norms = np.linalg.norm(cand_matrix, axis=1)
        dot_products = (cand_matrix @ user_vec.T).flatten()
        results: List[Optional[float]] = []
        for dot, norm in zip(dot_products, norms):
            if not math.isfinite(float(norm)) or norm <= 0:
                results.append(None)
                continue
            score = float(dot / (norm * user_norm))
            results.append(score if math.isfinite(score) else None)
        return results

    async def get_recommendations(
        self, user_id: int, candidate_ids: List[int], limit: int = None
    ):
        limit = min(limit or settings.DEFAULT_LIMIT, settings.MAX_LIMIT)
        candidate_ids = list(dict.fromkeys(
            candidate_id for candidate_id in candidate_ids[: settings.MAX_CANDIDATES]
            if candidate_id != user_id
        ))
        if not candidate_ids:
            return {
                "recommendations": [],
                "cold_start": False,
                "status": "no_candidates",
                "total_scored": 0,
            }

        all_ids = list(dict.fromkeys([user_id] + candidate_ids))
        embeddings = await self._get_embeddings_batch(all_ids)
        revenue_signals = await self._get_revenue_signals_batch(candidate_ids)
        user_emb = embeddings.get(user_id)

        if not user_emb:
            popular = await self._get_cold_start_recommendations(
                user_id, candidate_ids, limit
            )
            return {
                "recommendations": popular,
                "cold_start": True,
                "fallback": "observed_popularity" if popular else "none",
                "status": "ok" if popular else "insufficient_data",
                "message": (
                    "Using observed popularity for eligible candidates."
                    if popular else
                    "No user embedding or observed popularity data is available."
                ),
            }

        actual_ids = [candidate_id for candidate_id in candidate_ids if embeddings.get(candidate_id)]
        candidate_embs = [embeddings[candidate_id] for candidate_id in actual_ids]
        similarities = self._compute_similarities_vectorized(user_emb, candidate_embs)

        results = []
        weights = settings.RECOMMENDATION_WEIGHTS
        for candidate_id, similarity in zip(actual_ids, similarities):
            if similarity is None:
                continue

            components = {"embedding": similarity}
            revenue = revenue_signals.get(candidate_id)
            if revenue is not None:
                components["revenue"] = revenue

            active_weights = {
                name: float(weights.get(name, 0.0))
                for name in components
                if math.isfinite(float(weights.get(name, 0.0))) and float(weights.get(name, 0.0)) > 0
            }
            weight_total = sum(active_weights.values())
            if weight_total > 0:
                final_score = sum(
                    components[name] * active_weights[name] for name in active_weights
                ) / weight_total
            else:
                final_score = similarity

            result = {
                "user_id": candidate_id,
                "score": round(float(final_score), 4),
                "score_type": "weighted_observed_features" if len(components) > 1 else "similarity_only",
                "score_components": {
                    name: round(float(value), 4) for name, value in components.items()
                },
                "explanation": [
                    "embedding_similarity",
                    *(["observed_revenue_signal"] if revenue is not None else []),
                ],
            }
            results.append(result)

        results.sort(key=lambda item: item["score"], reverse=True)
        return {
            "recommendations": results[:limit],
            "cold_start": False,
            "status": "ok" if results else "insufficient_data",
            "total_scored": len(results),
            "excluded_count": len(candidate_ids) - len(actual_ids),
        }

    async def _get_popular_fallback(self) -> List[Dict]:
        """Return validated observed popularity data; never invent candidate IDs."""
        raw = await self.redis.get(settings.POPULAR_USERS_KEY)
        if not raw:
            return []
        try:
            records = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            logger.warning("Ignoring malformed observed-popularity cache")
            return []
        if not isinstance(records, list):
            return []

        valid_records = []
        for record in records:
            if not isinstance(record, dict):
                continue
            try:
                candidate_id = int(record.get("user_id"))
                score = float(record.get("score"))
            except (TypeError, ValueError):
                continue
            if candidate_id <= 0 or not math.isfinite(score):
                continue
            valid_records.append({
                "user_id": candidate_id,
                "score": score,
                "reason": "observed_popularity",
            })
        return valid_records[: settings.MAX_CANDIDATES]

    async def predict_match_score(
        self, user_a: int, user_b: int
    ) -> Optional[float]:
        embeddings = await self._get_embeddings_batch([user_a, user_b])
        emb_a = embeddings.get(user_a)
        emb_b = embeddings.get(user_b)
        if not emb_a or not emb_b:
            return None
        scores = self._compute_similarities_vectorized(emb_a, [emb_b])
        return scores[0] if scores else None

    async def track_events(self, payload: dict):
        """Event tracking with Redis Stream; schema/idempotency remains a follow-up gap."""
        try:
            await self.redis.xadd(
                "ml:training:events",
                {
                    "payload": json.dumps(payload),
                    "ts": str(__import__("datetime").datetime.utcnow()),
                },
                maxlen=settings.STREAM_MAXLEN,
                approximate=True,
            )
            logger.info(
                "Tracked %s events to Redis Stream",
                len(payload.get("events", [])) if isinstance(payload, dict) else 0,
            )
        except Exception as exc:
            logger.error("Failed to track events: %s", exc)

    async def _get_cold_start_recommendations(
        self, user_id: int, candidate_ids: List[int], limit: int
    ) -> List[Dict]:
        allowed_ids = set(candidate_ids)
        observed = await self._get_popular_fallback()
        eligible = [
            item for item in observed
            if item["user_id"] in allowed_ids and item["user_id"] != user_id
        ]
        eligible.sort(key=lambda item: item["score"], reverse=True)
        return eligible[:limit]
