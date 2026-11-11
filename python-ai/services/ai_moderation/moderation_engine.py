import asyncio
import hashlib
import logging
import math
import os
from typing import Dict, List

import httpx
from moderation_rules import rule_based_check

logger = logging.getLogger(__name__)

EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://embedded_ai:8100")

_BANNED_EXEMPLARS: List[str] = [
    "لطفاً آیدی تلگرامت رو بده",
    "میخوام از این اپ بریم بیرون",
    "شماره تلفنت رو بده",
    "please give me your contact outside this app",
    "بیا توی واتساپ حرف بزنیم",
]

SEMANTIC_THRESHOLD = 0.72


class ModerationEngine:
    """
    مدیریت محتوا با دو لایه:
    1. Rule-based  — سریع، محلی
    2. Semantic    — دقیق‌تر، از طریق embedding service
    """

    def __init__(self):
        self._cache: Dict[str, Dict] = {}

    # ── API عمومی ──────────────────────────────────────────────────────────────

    async def moderate_text(self, text: str, context: str = "message") -> Dict:
        if not isinstance(text, str) or not text.strip():
            return {
                "allowed": False,
                "reason": "invalid_input",
                "confidence": 0.0,
                "layer": "validation",
            }

        text = text.strip()
        cache_key = hashlib.md5(f"{context}:{text}".encode()).hexdigest()

        if cache_key in self._cache:
            return self._cache[cache_key]

        result = self._rule_based_check(text)

        if result["allowed"]:
            result = await self._semantic_check(text)

        if result.get("layer") != "semantic_unavailable":
            self._cache[cache_key] = result
        return result

    async def moderate_batch(
        self, texts: List[str], context: str = "message"
    ) -> List[Dict]:
        return await asyncio.gather(*[self.moderate_text(t, context) for t in texts])

    # ── لایه rule-based ───────────────────────────────────────────────────────

    def _rule_based_check(self, text: str) -> Dict:
        # High-specificity contextual rules live in a pure, independently
        # testable module. Broad isolated-word substring blocking is avoided.
        return rule_based_check(text)

    # ── لایه semantic ─────────────────────────────────────────────────────────

    async def _semantic_check(self, text: str) -> Dict:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # embedding متن ورودی
                r = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed",
                    json={"text": text},
                )
                r.raise_for_status()
                text_payload = r.json()
                text_emb = text_payload.get("embedding") if isinstance(text_payload, dict) else None
                if not isinstance(text_emb, list) or not text_emb:
                    raise ValueError("embedding service returned an invalid text vector")
                if any(
                    isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(float(value))
                    for value in text_emb
                ):
                    raise ValueError("embedding service returned non-finite text vector values")
                text_emb = [float(value) for value in text_emb]

                # embedding همه exemplarها به صورت batch
                r_batch = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed/batch",
                    json={"texts": _BANNED_EXEMPLARS},
                )
                r_batch.raise_for_status()
                batch_payload = r_batch.json()
                exemplar_embs = batch_payload.get("embeddings") if isinstance(batch_payload, dict) else None
                if not isinstance(exemplar_embs, list) or len(exemplar_embs) != len(_BANNED_EXEMPLARS):
                    raise ValueError("embedding service returned an incomplete exemplar batch")

                validated_exemplars = []
                for ex_emb in exemplar_embs:
                    if not isinstance(ex_emb, list) or len(ex_emb) != len(text_emb):
                        raise ValueError("embedding service returned an incompatible exemplar vector")
                    if any(
                        isinstance(value, bool) or not isinstance(value, (int, float))
                        or not math.isfinite(float(value))
                        for value in ex_emb
                    ):
                        raise ValueError("embedding service returned non-finite exemplar vector values")
                    validated_exemplars.append([float(value) for value in ex_emb])

                # بررسی similarity با همه exemplarها؛ هر پاسخ ناقص/نامعتبر fail-closed است.
                max_sim = 0.0
                matched_exemplar = None

                for exemplar, ex_emb in zip(_BANNED_EXEMPLARS, validated_exemplars):
                    r_sim = await client.post(
                        f"{EMBEDDING_SERVICE_URL}/similarity",
                        json={"vector_a": text_emb, "vector_b": ex_emb},
                    )
                    r_sim.raise_for_status()
                    similarity_payload = r_sim.json()
                    sim = similarity_payload.get("similarity") if isinstance(similarity_payload, dict) else None
                    if (
                        isinstance(sim, bool)
                        or not isinstance(sim, (int, float))
                        or not math.isfinite(float(sim))
                        or float(sim) < -1.0
                        or float(sim) > 1.0
                    ):
                        raise ValueError("embedding service returned an invalid similarity")
                    sim = float(sim)
                    if sim > max_sim:
                        max_sim = sim
                        matched_exemplar = exemplar

                if max_sim >= SEMANTIC_THRESHOLD:
                    return {
                        "allowed": False,
                        "reason": "semantic_violation",
                        "matched_exemplar": matched_exemplar,
                        "confidence": round(max_sim, 3),
                        "layer": "semantic",
                    }

        except Exception as exc:
            logger.error("Semantic moderation failed; refusing pending review: %s", exc)
            return {
                "allowed": False,
                "reason": "moderation_unavailable",
                "confidence": 0.0,
                "layer": "semantic_unavailable",
            }

        return {"allowed": True, "reason": None, "confidence": 1.0, "layer": "semantic"}
