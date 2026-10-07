import json
import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

VECTOR_PREFIX = "vec:"
INDEX_KEY = "vec:index"
SCAN_COUNT = 500


class RedisVectorStore:
    def __init__(self, redis_client):
        self.redis = redis_client

    def _raw_key(self, logical: str) -> str:
        return f"{VECTOR_PREFIX}{logical}"

    def _norm_key(self, logical: str) -> str:
        return f"{VECTOR_PREFIX}{logical}:norm"

    @staticmethod
    def _normalize(vector: List[float]) -> List[float]:
        v = np.array(vector, dtype=np.float32)
        norm = np.linalg.norm(v)
        return (v / norm).tolist() if norm > 0 else vector

    async def _scan_index(self) -> List[str]:
        members = await self.redis.smembers(INDEX_KEY)
        return list(members)

    async def store_user_vector(
        self, user_id: int, vector: List[float], ttl: int = 86400
    ) -> None:
        logical = f"user:{user_id}"
        normalized = self._normalize(vector)
        pipe = self.redis.pipeline()
        pipe.set(self._raw_key(logical), json.dumps(vector), ex=ttl)
        pipe.set(self._norm_key(logical), json.dumps(normalized), ex=ttl)
        pipe.sadd(INDEX_KEY, logical)
        await pipe.execute()

    async def store_content_vector(
        self, content_id: int, content_type: str, vector: List[float], ttl: int = 604800
    ) -> None:
        logical = f"{content_type}:{content_id}"
        normalized = self._normalize(vector)
        pipe = self.redis.pipeline()
        pipe.set(self._raw_key(logical), json.dumps(vector), ex=ttl)
        pipe.set(self._norm_key(logical), json.dumps(normalized), ex=ttl)
        pipe.sadd(INDEX_KEY, logical)
        await pipe.execute()

    async def remove_user_vector(self, user_id: int) -> None:
        logical = f"user:{user_id}"
        pipe = self.redis.pipeline()
        pipe.delete(self._raw_key(logical))
        pipe.delete(self._norm_key(logical))
        pipe.srem(INDEX_KEY, logical)
        await pipe.execute()

    async def get_vector(
        self, logical_key: str
    ) -> Optional[Tuple[List[float], List[float]]]:
        raw = await self.redis.get(self._raw_key(logical_key))
        if raw is None:
            # پاکسازی stale entry از index
            await self.redis.srem(INDEX_KEY, logical_key)
            return None
        vector = json.loads(raw)
        norm_raw = await self.redis.get(self._norm_key(logical_key))
        normalized = json.loads(norm_raw) if norm_raw else self._normalize(vector)
        return vector, normalized

    async def find_similar_users(
        self, user_id: int, limit: int = 10
    ) -> List[Tuple[int, float]]:
        target_key = f"user:{user_id}"
        result = await self.get_vector(target_key)
        if result is None:
            return []
        _, target_norm = result
        target_np = np.array(target_norm, dtype=np.float32)

        all_members = await self.redis.smembers(INDEX_KEY)
        user_keys = [
            k for k in all_members if k.startswith("user:") and k != target_key
        ]

        pipe = self.redis.pipeline()
        for k in user_keys:
            pipe.get(self._norm_key(k))
        norms_data = await pipe.execute()

        scores: List[Tuple[int, float]] = []
        stale_keys: List[str] = []

        for k, nd in zip(user_keys, norms_data):
            if nd is None:
                stale_keys.append(k)  # جمع‌آوری stale keys
                continue
            other_np = np.array(json.loads(nd), dtype=np.float32)
            sim = float(np.dot(target_np, other_np))
            other_id = int(k.split(":")[1])
            scores.append((other_id, sim))

        # پاکسازی stale entries از index
        if stale_keys:
            pipe = self.redis.pipeline()
            for k in stale_keys:
                pipe.srem(INDEX_KEY, k)
            await pipe.execute()
            logger.debug("Cleaned %d stale index entries", len(stale_keys))

        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:limit]

    async def semantic_search(
        self,
        query_vec: List[float],
        content_type: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict]:
        query_norm = np.array(self._normalize(query_vec), dtype=np.float32)

        all_members = await self.redis.smembers(INDEX_KEY)
        keys = [
            k
            for k in all_members
            if (not content_type or k.startswith(f"{content_type}:"))
        ]

        pipe = self.redis.pipeline()
        for k in keys:
            pipe.get(self._norm_key(k))
        norms_data = await pipe.execute()

        results: List[Dict] = []
        stale_keys: List[str] = []

        for k, nd in zip(keys, norms_data):
            if nd is None:
                stale_keys.append(k)
                continue
            other_np = np.array(json.loads(nd), dtype=np.float32)
            sim = float(np.dot(query_norm, other_np))
            parts = k.split(":", 1)
            results.append({"type": parts[0], "id": parts[1], "similarity": sim})

        if stale_keys:
            pipe = self.redis.pipeline()
            for k in stale_keys:
                pipe.srem(INDEX_KEY, k)
            await pipe.execute()

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:limit]
