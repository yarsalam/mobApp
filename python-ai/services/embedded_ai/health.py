import asyncio
import logging
from typing import Dict

logger = logging.getLogger(__name__)


async def comprehensive_health_check(worker, encode_text_fn) -> Dict:
    status = {"status": "healthy", "checks": {}}

    # Redis
    try:
        await worker.redis_client.ping()
        info = await worker.redis_client.info("memory")
        status["checks"]["redis"] = {
            "status": "ok",
            "memory_used": info["used_memory_human"],
            "connections": info.get("connected_clients", 0),
        }
    except Exception as exc:
        status["status"] = "degraded"
        status["checks"]["redis"] = {"status": "error", "error": str(exc)}

    # MySQL
    try:
        async with worker.mysql_pool.acquire() as conn:
            await conn.ping()
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1")
        status["checks"]["mysql"] = {"status": "ok"}
    except Exception as exc:
        status["status"] = "degraded"
        status["checks"]["mysql"] = {"status": "error", "error": str(exc)}

    # Model
    try:
        loop = asyncio.get_event_loop()
        emb = await loop.run_in_executor(
            worker.pool, encode_text_fn, worker.model, "test"
        )
        status["checks"]["model"] = {"status": "ok", "vector_dim": len(emb)}
    except Exception as exc:
        status["status"] = "degraded"
        status["checks"]["model"] = {"status": "error", "error": str(exc)}

    # Queue
    try:
        queue_length: int = await worker.redis_client.llen("embedding:queue")
        status["checks"]["queue"] = {"status": "ok", "length": queue_length}
        if queue_length > 10000:
            status["status"] = "warning"
            status["checks"]["queue"]["warning"] = "Queue is getting long"
    except Exception as exc:
        status["status"] = "degraded"
        status["checks"]["queue"] = {"status": "error", "error": str(exc)}

    # Vectors
    try:
        vector_count: int = await worker.redis_client.scard(
            worker.vector_store.index_key
        )
        status["checks"]["vectors"] = {"status": "ok", "count": vector_count}
    except Exception as exc:
        status["checks"]["vectors"] = {"status": "error", "error": str(exc)}

    return status
