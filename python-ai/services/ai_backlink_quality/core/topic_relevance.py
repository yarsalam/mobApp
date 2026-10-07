import logging
import os
from typing import List

import httpx

logger = logging.getLogger(__name__)

EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://embedded_ai:8100")


class TopicRelevance:
    """شباهت موضوعی از طریق embedding service مرکزی (بدون بارگذاری مدل محلی)."""

    async def compute_similarity(self, source_text: str, target_text: str) -> float:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r_a = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed", json={"text": source_text}
                )
                r_b = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed", json={"text": target_text}
                )
                r_a.raise_for_status()
                r_b.raise_for_status()

                sim_resp = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/similarity",
                    json={
                        "vector_a": r_a.json()["embedding"],
                        "vector_b": r_b.json()["embedding"],
                    },
                )
                sim_resp.raise_for_status()
                return float(sim_resp.json()["similarity"])
        except Exception as exc:
            logger.error("Topic similarity failed: %s", exc)
            return 0.0
