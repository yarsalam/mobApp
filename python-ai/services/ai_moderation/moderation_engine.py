import asyncio
import hashlib
import logging
import os
from typing import Dict, List

import httpx

logger = logging.getLogger(__name__)

EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://embedded_ai:8100")

_BANNED_KEYWORDS: List[str] = [
    "تلگرام",
    "واتساپ",
    "اینستاگرام",
    "کانال",
    "گروه",
    "ایدی",
    "telegram",
    "whatsapp",
    "instagram",
    "@",
    "t.me",
    "خرید",
    "فروش",
    "قیمت",
    "تومان",
    "ریال",
]

_VIOLENCE_KEYWORDS: List[str] = [
    "کشتن",
    "مرگ",
    "خودکشی",
    "آزار",
    "تهدید",
    "kill",
    "murder",
    "suicide",
    "threat",
    "abuse",
]

_BANNED_EXEMPLARS: List[str] = [
    "لطفاً آیدی تلگرامت رو بده",
    "میخوام از این اپ بریم بیرون",
    "شماره تلفنت رو بده",
    "please give me your contact outside this app",
    "بیا توی واتساپ حرف بزنیم",
]

SEMANTIC_THRESHOLD = 0.72
MAX_TEXT_LENGTH = 2000


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
        if not text or not text.strip():
            return {"allowed": True, "reason": None, "confidence": 1.0, "layer": "none"}

        text = text.strip()
        cache_key = hashlib.md5(f"{context}:{text}".encode()).hexdigest()

        if cache_key in self._cache:
            return self._cache[cache_key]

        result = self._rule_based_check(text)

        if result["allowed"]:
            result = await self._semantic_check(text)

        self._cache[cache_key] = result
        return result

    async def moderate_batch(
        self, texts: List[str], context: str = "message"
    ) -> List[Dict]:
        return await asyncio.gather(*[self.moderate_text(t, context) for t in texts])

    # ── لایه rule-based ───────────────────────────────────────────────────────

    def _rule_based_check(self, text: str) -> Dict:
        text_lower = text.lower()

        for kw in _BANNED_KEYWORDS:
            if kw.lower() in text_lower:
                return {
                    "allowed": False,
                    "reason": "banned_keyword",
                    "matched": kw,
                    "confidence": 1.0,
                    "layer": "rule",
                }

        for kw in _VIOLENCE_KEYWORDS:
            if kw.lower() in text_lower:
                return {
                    "allowed": False,
                    "reason": "violence_keyword",
                    "matched": kw,
                    "confidence": 0.9,
                    "layer": "rule",
                }

        if len(text) > MAX_TEXT_LENGTH:
            return {
                "allowed": False,
                "reason": "text_too_long",
                "confidence": 1.0,
                "layer": "rule",
            }

        return {"allowed": True, "reason": None, "confidence": 1.0, "layer": "rule"}

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
                text_emb = r.json()["embedding"]

                # embedding همه exemplarها به صورت batch
                r_batch = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed/batch",
                    json={"texts": _BANNED_EXEMPLARS},
                )
                r_batch.raise_for_status()
                exemplar_embs = r_batch.json()["embeddings"]

                # بررسی similarity با هر exemplar
                max_sim = 0.0
                matched_exemplar = None

                for exemplar, ex_emb in zip(_BANNED_EXEMPLARS, exemplar_embs):
                    r_sim = await client.post(
                        f"{EMBEDDING_SERVICE_URL}/similarity",
                        json={"vector_a": text_emb, "vector_b": ex_emb},
                    )
                    r_sim.raise_for_status()
                    sim = r_sim.json()["similarity"]
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
            logger.error("Semantic moderation failed, defaulting to allow: %s", exc)

        return {"allowed": True, "reason": None, "confidence": 1.0, "layer": "semantic"}
