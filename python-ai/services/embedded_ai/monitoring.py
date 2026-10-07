import logging
from typing import Optional

logger = logging.getLogger(__name__)


class RedisMonitor:
    def __init__(
        self,
        redis_client,
        warning_threshold: float = 0.7,
        critical_threshold: float = 0.85,
    ):
        self.redis = redis_client
        self.warning = warning_threshold
        self.critical = critical_threshold

    async def check_memory(self) -> float:
        info = await self.redis.info("memory")
        used: int = info["used_memory"]
        max_memory: int = info.get("maxmemory") or info.get(
            "total_system_memory", 8 * 1024**3
        )
        ratio = used / max_memory

        if ratio > self.critical:
            logger.critical("Redis memory CRITICAL: %.1f%% used", ratio * 100)
            await self._evict_old_vectors()
        elif ratio > self.warning:
            logger.warning("Redis memory WARNING: %.1f%% used", ratio * 100)

        return ratio

    async def _evict_old_vectors(self) -> None:
        """حذف vectorهایی که TTL کمتری دارند (یعنی نزدیک به انقضا)."""
        cursor = 0
        to_delete = []
        while True:
            cursor, batch = await self.redis.scan(
                cursor=cursor, match="vec:*", count=500
            )
            pipe = self.redis.pipeline()
            for key in batch:
                pipe.ttl(key)
            ttls = await pipe.execute()
            for key, ttl in zip(batch, ttls):
                if 0 < ttl < 86400:
                    to_delete.append(key)
            if cursor == 0:
                break

        if to_delete:
            await self.redis.delete(*to_delete)
            logger.info("Evicted %d old vectors", len(to_delete))
