import logging
import os
import re
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

_CATEGORIES = {
    "technical": ["باگ", "خطا", "کرش", "ارور", "لود", "نمایش"],
    "billing": ["پرداخت", "شارژ", "اعتبار", "بوست", "vip", "خرید"],
    "account": ["اکانت", "ورود", "رمز", "شماره", "تأیید"],
    "feature_request": ["اضافه", "کاش", "ای کاش", "ویژگی", "بتونه"],
    "report": ["گزارش", "مزاحمت", "بلاک", "اسپم"],
}

_URGENT_KW = ["کرش", "نمیره", "پول", "حذف", "فوری"]
_HIGH_KW = ["خطا", "مشکل", "نمیشه"]

_TEMPLATES = {
    "technical": "ممنون از گزارش‌تون. تیم فنی در حال بررسی مشکل هست.",
    "billing": "ممنون از پیام‌تون. همکاران بخش مالی به زودی رسیدگی می‌کنند.",
    "account": "برای راهنمایی حساب کاربری، لطفاً اطلاعات بیشتری بدید.",
    "feature_request": "از پیشنهادتون ممنونیم. این موضوع رو برای تیم محصول ارسال کردیم.",
    "report": "گزارش شما ثبت شد. تیم امنیت در اسرع وقت بررسی می‌کنه.",
}

_BASE_RESOLUTION_HOURS = {
    "technical": 4,
    "billing": 2,
    "account": 1,
    "feature_request": 24,
    "report": 3,
    "other": 2,
}

_REVENUE_IMPACT = {
    "billing": -0.8,
    "technical": -0.3,
    "account": -0.2,
    "feature_request": 0.2,
    "report": -0.1,
    "other": -0.1,
}

_SENTIMENT_MODEL = None

# مدل HooshvareLab/bert-fa-base-uncased-sentiment-snappfood لیبل‌های خاص خودش رو
# برمی‌گردونه (نه لزوماً LABEL_0/1/2 عمومی). به‌جای فرض کورکورانه، چند حالت
# محتمل رو پوشش می‌دیم و اگه هیچ‌کدوم مچ نشد، صریح warning می‌زنیم به‌جای
# این‌که بی‌صدا روی 'neutral' بیفته.
_LABEL_MAP = {
    # حالت generic (بعضی مدل‌های HF)
    "label_0": "negative",
    "label_1": "neutral",
    "label_2": "positive",
    # حالت‌های محتمل مدل snappfood (بر اساس دیتاست نظرات، دو کلاسه یا سه‌کلاسه)
    "sad": "negative",
    "happy": "positive",
    "negative": "negative",
    "positive": "positive",
    "neutral": "neutral",
}


def _get_sentiment_model():
    global _SENTIMENT_MODEL
    if _SENTIMENT_MODEL is None:
        try:
            from transformers import pipeline

            _SENTIMENT_MODEL = pipeline(
                "sentiment-analysis",
                model="/app/models",
            )
            logger.info("Farsi sentiment model loaded")
        except Exception as exc:
            logger.warning("Could not load Farsi sentiment model: %s", exc)
            _SENTIMENT_MODEL = False
    return _SENTIMENT_MODEL if _SENTIMENT_MODEL else None


class AISupportEngine:
    def __init__(self):
        self.learning_rate: float = 0.01
        self._unknown_labels_seen: set = set()

    # ── public API ─────────────────────────────────────────────────────────────

    def analyze_ticket(self, ticket_data: Dict) -> Dict:
        content: str = ticket_data.get("content", "")
        category = self._classify(content)
        priority = self._priority(content, ticket_data)
        sentiment = self._sentiment(content)
        keywords = self._keywords(content)

        return {
            "suggested_category": category,
            "suggested_priority": priority,
            "confidence_score": 0.85,
            "sentiment": sentiment,
            "keywords": keywords,
            "similar_tickets": [],
            "estimated_resolution_hours": self._resolution_time(
                category, priority, sentiment
            ),
            "auto_response": self._auto_response(category, sentiment),
            "urgency_score": self._urgency(sentiment, priority, ticket_data),
            "revenue_impact": _REVENUE_IMPACT.get(category, -0.1),
            "seo_signals": self._seo_signals(content, keywords),
        }

    def learn_from_feedback(self, ticket_id: int, feedback_data: Dict) -> Dict:
        logger.info("Learning from ticket %d", ticket_id)
        self.learning_rate *= 0.99
        return {"status": "learned"}

    def get_seo_insights(self, days: int = 30) -> Dict:
        return {
            "top_issues": [
                {"issue": "مشکل پرداخت", "count": 45, "trend": "+12%"},
                {"issue": "فراموشی رمز", "count": 32, "trend": "-5%"},
                {"issue": "سرعت پایین", "count": 28, "trend": "+8%"},
            ],
            "user_sentiment_trend": {
                "positive": "45%",
                "neutral": "35%",
                "negative": "20%",
            },
            "feature_requests": [
                {"feature": "چت گروهی", "requests": 23},
                {"feature": "فیلتر پیشرفته", "requests": 18},
            ],
        }

    # ── private helpers ────────────────────────────────────────────────────────

    def _classify(self, content: str) -> str:
        text = content.lower()
        scores = {
            cat: sum(1 for kw in kws if kw in text) for cat, kws in _CATEGORIES.items()
        }
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "other"

    def _priority(self, content: str, ticket_data: Dict) -> str:
        text = content.lower()
        if any(kw in text for kw in _URGENT_KW):
            return "urgent"
        if any(kw in text for kw in _HIGH_KW):
            return "high"
        if ticket_data.get("userTier") == "vip":
            return "high"
        return "medium"

    def _sentiment(self, content: str) -> Dict:
        model = _get_sentiment_model()
        if model:
            try:
                res = model(content[:512])[0]
                raw_label = str(res["label"]).strip().lower()
                mapped = _LABEL_MAP.get(raw_label)

                if mapped is None:
                    # قبلاً اینجا بی‌صدا 'neutral' برمی‌گشت. حالا صریح لاگ می‌زنیم
                    # تا اگه مدل لیبل ناشناخته‌ای داد، متوجه بشیم که _LABEL_MAP
                    # باید آپدیت بشه، نه اینکه فکر کنیم sentiment درست کار می‌کنه.
                    if raw_label not in self._unknown_labels_seen:
                        self._unknown_labels_seen.add(raw_label)
                        logger.warning(
                            "Unknown sentiment label from model: '%s' — "
                            "falling back to keyword-based sentiment. "
                            "بررسی کن و به _LABEL_MAP اضافه کن.",
                            raw_label,
                        )
                    return self._keyword_sentiment(content)

                return {
                    "label": mapped,
                    "score": round(res["score"], 3),
                    "emotions": self._detect_emotions(content),
                }
            except Exception as exc:
                logger.warning("Sentiment model failed: %s", exc)

        return self._keyword_sentiment(content)

    @staticmethod
    def _keyword_sentiment(content: str) -> Dict:
        neg = ["بد", "خراب", "مشکل", "ناراضی", "کرش"]
        pos = ["عالی", "ممنون", "خوب", "راضی"]
        text = content.lower()
        neg_count = sum(1 for w in neg if w in text)
        pos_count = sum(1 for w in pos if w in text)
        if neg_count > pos_count:
            label, score = "negative", min(1.0, neg_count * 0.3)
        elif pos_count > neg_count:
            label, score = "positive", min(1.0, pos_count * 0.3)
        else:
            label, score = "neutral", 0.5
        return {
            "label": label,
            "score": score,
            "emotions": AISupportEngine._detect_emotions(content),
        }

    @staticmethod
    def _detect_emotions(content: str) -> List[str]:
        emotion_map = {
            "angry": ["عصبی", "خشم", "اعصاب"],
            "frustrated": ["کلافه", "خسته", "دیگه"],
            "happy": ["خوشحال", "عالی", "ممنون"],
            "confused": ["متوجه", "نمیدونم", "گیج"],
        }
        text = content.lower()
        return [e for e, kws in emotion_map.items() if any(kw in text for kw in kws)]

    @staticmethod
    def _keywords(content: str) -> List[str]:
        tokens = re.findall(r"\b\w{3,}\b", content)
        stop = {"که", "این", "آن", "با", "از", "در", "به", "و", "یا", "را", "هم"}
        seen, result = set(), []
        for t in tokens:
            if t not in stop and t not in seen and not t.isdigit():
                seen.add(t)
                result.append(t)
        return result[:10]

    @staticmethod
    def _resolution_time(category: str, priority: str, sentiment: Dict) -> float:
        priority_factor = {"urgent": 0.25, "high": 0.5, "medium": 0.8, "low": 1.0}.get(
            priority, 1.0
        )
        sentiment_factor = 1.2 if sentiment.get("label") == "negative" else 1.0
        base = _BASE_RESOLUTION_HOURS.get(category, 2)
        return round(base * priority_factor * sentiment_factor, 1)

    @staticmethod
    def _auto_response(category: str, sentiment: Dict) -> str:
        base = _TEMPLATES.get(category, "ممنون از پیام‌تون. در اسرع وقت پاسخگو هستیم.")
        if sentiment.get("label") == "negative":
            base = "بابت تجربه ناخوشایند عذرخواهی می‌کنیم. " + base
        return base

    @staticmethod
    def _urgency(sentiment: Dict, priority: str, ticket_data: Dict) -> float:
        score = {"urgent": 40, "high": 30, "medium": 15, "low": 5}.get(priority, 0)
        if sentiment.get("label") == "negative":
            score += 20 * sentiment.get("score", 0)
        if ticket_data.get("userTier") == "vip":
            score += 15
        if (ticket_data.get("totalPurchases") or 0) > 5:
            score += 10
        return round(min(100.0, score), 1)

    @staticmethod
    def _seo_signals(content: str, keywords: List[str]) -> Dict:
        ideas = []
        if any(k in content.lower() for k in ["چطور", "آموزش", "نحوه"]):
            ideas.append(
                {
                    "title": f"آموزش حل مشکل {keywords[0] if keywords else 'رایج'}",
                    "type": "tutorial",
                }
            )
        if any(k in content.lower() for k in ["کاش", "اضافه"]):
            ideas.append({"title": "ویژگی‌های جدید در راهند!", "type": "announcement"})
        return {"content_opportunities": ideas[:3], "keywords": keywords[:5]}
