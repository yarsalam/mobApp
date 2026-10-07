import json
import logging
from typing import Any, Optional

import redis

from config.settings import settings

logger = logging.getLogger(__name__)


class RedisClient:
    def __init__(self):
        self.client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            decode_responses=True,
            socket_connect_timeout=5,
            retry_on_timeout=True,
        )

    def set_metric(self, key: str, value: Any, ttl: int = 3600) -> None:
        try:
            self.client.setex(f"metric:{key}", ttl, json.dumps(value, default=str))
        except Exception as exc:
            logger.error("Redis set_metric failed [%s]: %s", key, exc)

    def get_metric(self, key: str) -> Optional[Any]:
        try:
            raw = self.client.get(f"metric:{key}")
            return json.loads(raw) if raw else None
        except Exception as exc:
            logger.error("Redis get_metric failed [%s]: %s", key, exc)
            return None

    def push_to_queue(self, queue: str, data: Any) -> None:
        try:
            self.client.rpush(f"queue:{queue}", json.dumps(data, default=str))
        except Exception as exc:
            logger.error("Redis push failed [%s]: %s", queue, exc)

    def pop_from_queue(self, queue: str, timeout: int = 1) -> Optional[Any]:
        try:
            result = self.client.blpop(f"queue:{queue}", timeout=timeout)
            return json.loads(result[1]) if result else None
        except Exception as exc:
            logger.error("Redis pop failed [%s]: %s", queue, exc)
            return None
