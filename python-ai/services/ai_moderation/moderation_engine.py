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
    "لطفاً آیدی تلگرامت را برای ادامه گفتگو خارج از برنامه بفرست",
    "میخوام از این اپ بریم بیرون و در پیام رسان دیگری گفتگو کنیم",
    "شماره تلفنت را برای ارتباط خارج از برنامه بفرست",
    "please give me your contact outside this app",
    "بیا توی واتساپ حرف بزنیم",
]

# Contrastive neutral examples reduce false blocks when a message merely
# discusses a platform, group, price, threat-prevention or safety reporting.
_SAFE_EXEMPLARS: List[str] = [
    "گروه کتاب خوانی محله مان هر هفته جلسه دارد",
    "قیمت کتاب را از کتاب فروشی پرسیدم",
    "درباره کانال تلویزیونی مستند صحبت می کردیم",
    "در اینستاگرام کاری ندارم درباره هنر کلاسیک حرف می زنم",
    "از تهدید و خشونت در گفتگو استفاده نکنیم",
    "می خواهم اختلاف را بدون تهدید حل کنیم",
    "اگر احساس خطر کردی گفتگو را متوقف و گزارش کن",
    "به خرید و فروش آثار هنری علاقه ای ندارم بیشتر کتاب می خوانم",
]

SEMANTIC_THRESHOLD = 0.72
SEMANTIC_MARGIN = 0.10


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
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed",
                    json={"text": text},
                )
                response.raise_for_status()
                text_payload = response.json()
                text_emb = text_payload.get("embedding") if isinstance(text_payload, dict) else None
                if not isinstance(text_emb, list) or not text_emb:
                    raise ValueError("embedding service returned an invalid text vector")

                exemplar_texts = _BANNED_EXEMPLARS + _SAFE_EXEMPLARS
                batch_response = await client.post(
                    f"{EMBEDDING_SERVICE_URL}/embed/batch",
                    json={"texts": exemplar_texts},
                )
                batch_response.raise_for_status()
                batch_payload = batch_response.json()
                exemplar_embs = batch_payload.get("embeddings") if isinstance(batch_payload, dict) else None
                if not isinstance(exemplar_embs, list) or len(exemplar_embs) != len(exemplar_texts):
                    raise ValueError("embedding service returned an incomplete exemplar batch")

                all_vectors = [text_emb, *exemplar_embs]
                dimension = len(text_emb)
                if dimension == 0:
                    raise ValueError("embedding service returned an empty vector")

                validated: List[List[float]] = []
                for vector in all_vectors:
                    if not isinstance(vector, list) or len(vector) != dimension:
                        raise ValueError("embedding service returned incompatible vector dimensions")
                    if any(
                        isinstance(value, bool)
                        or not isinstance(value, (int, float))
                        or not math.isfinite(float(value))
                        for value in vector
                    ):
                        raise ValueError("embedding service returned non-finite vector values")
                    validated.append([float(value) for value in vector])

                text_vector = validated[0]
                text_norm = math.sqrt(sum(value * value for value in text_vector))
                if not math.isfinite(text_norm) or text_norm == 0:
                    raise ValueError("embedding service returned a zero or invalid text vector")

                def cosine_similarity(vector: List[float]) -> float:
                    norm = math.sqrt(sum(value * value for value in vector))
                    if not math.isfinite(norm) or norm == 0:
                        raise ValueError("embedding service returned a zero or invalid exemplar vector")
                    score = sum(a * b for a, b in zip(text_vector, vector)) / (text_norm * norm)
                    if not math.isfinite(score) or score < -1.000001 or score > 1.000001:
                        raise ValueError("embedding service returned an invalid cosine similarity")
                    return max(-1.0, min(1.0, score))

                positive_scores = [
                    cosine_similarity(vector)
                    for vector in validated[1 : 1 + len(_BANNED_EXEMPLARS)]
                ]
                safe_scores = [
                    cosine_similarity(vector)
                    for vector in validated[1 + len(_BANNED_EXEMPLARS) :]
                ]

                best_positive_index = max(range(len(positive_scores)), key=positive_scores.__getitem__)
                max_positive = positive_scores[best_positive_index]
                max_safe = max(safe_scores, default=-1.0)
                margin = max_positive - max_safe

                if max_positive >= SEMANTIC_THRESHOLD and margin >= SEMANTIC_MARGIN:
                    return {
                        "allowed": False,
                        "reason": "semantic_violation",
                        "matched_exemplar": _BANNED_EXEMPLARS[best_positive_index],
                        "confidence": round(max_positive, 3),
                        "semantic_margin": round(margin, 3),
                        "layer": "semantic",
                    }

                return {
                    "allowed": True,
                    "reason": None,
                    "confidence": 1.0,
                    "semantic_best_positive": round(max_positive, 3),
                    "semantic_best_safe": round(max_safe, 3),
                    "semantic_margin": round(margin, 3),
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
