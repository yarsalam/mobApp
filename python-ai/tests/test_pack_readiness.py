from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai_support"))
sys.path.insert(0, str(ROOT / "services" / "ai_moderation"))
sys.path.insert(0, str(ROOT / "services" / "ai_image"))

from moderation_engine import ModerationEngine
from core.ticket_analyzer import AISupportEngine


def _load_support_api():
    path = ROOT / "services" / "ai_support" / "api" / "app.py"
    spec = importlib.util.spec_from_file_location("ai_support_api_under_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FailingEmbeddingClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        raise httpx.ConnectError("embedding dependency unavailable")


def test_moderation_fails_closed_when_embedding_is_unavailable(monkeypatch):
    import moderation_engine

    monkeypatch.setattr(moderation_engine.httpx, "AsyncClient", FailingEmbeddingClient)
    result = asyncio.run(ModerationEngine()._semantic_check("یک متن معمولی برای بررسی"))

    assert result["allowed"] is False
    assert result["reason"] == "semantic_check_unavailable"
    assert result["review_required"] is True
    assert result["confidence"] == 0.0


def test_support_classifier_marks_confidence_as_heuristic():
    engine = AISupportEngine()

    clear = engine.analyze_ticket({"content": "پرداخت شارژ خرید"})
    unknown = engine.analyze_ticket({"content": "سلام"})

    assert clear["classification_method"] == "keyword_rules"
    assert clear["confidence_type"] == "uncalibrated_keyword_heuristic"
    assert clear["confidence_score"] != 0.85
    assert unknown["suggested_category"] == "other"
    assert unknown["confidence_score"] == 0.0


def test_support_engine_does_not_return_fabricated_seo_metrics():
    insights = AISupportEngine().get_seo_insights(days=7)

    assert insights["status"] == "insufficient_data"
    assert insights["sample_count"] == 0
    assert insights["top_issues"] == []
    assert insights["feature_requests"] == []


class FakeAnalyticsRedis:
    def __init__(self):
        self.calls = 0
        self.records = {
            "ai_support:analytics:1": {
                "ticketId": 1, "category": "billing", "priority": "high",
                "sentiment": "negative", "keywords": ["پرداخت"],
            },
            "ai_support:analytics:2": {
                "ticketId": 2, "category": "technical", "priority": "medium",
                "sentiment": "positive", "keywords": ["خطا"],
            },
            "ai_support:analytics:3": {
                "ticketId": 3, "category": "billing", "priority": "medium",
                "sentiment": "neutral", "keywords": ["پرداخت"],
            },
        }

    async def zrangebyscore(self, key, minimum, maximum):
        self.calls += 1
        return ["1", "2"] if self.calls == 1 else ["3"]

    async def mget(self, keys):
        return [
            json.dumps(self.records[key]) if key in self.records else None
            for key in keys
        ]


def test_support_insights_are_aggregated_from_retained_records(monkeypatch):
    api = _load_support_api()
    monkeypatch.setattr(api, "redis_client", FakeAnalyticsRedis())

    result = asyncio.run(api.get_seo_insights(days=30))

    assert result["status"] == "ok"
    assert result["data_source"] == "retained_ticket_analysis_records"
    assert result["sample_count"] == 2
    assert result["user_sentiment_trend_percent"] == {"negative": 50.0, "positive": 50.0}
    billing = next(item for item in result["top_issues"] if item["category"] == "billing")
    assert billing["count"] == 1
    assert billing["previous_period_count"] == 1
    assert billing["trend_percent"] == 0.0


def test_exif_cleaner_returns_none_for_malformed_image():
    from security.exif_cleaner import EXIFCleaner

    assert EXIFCleaner.clean(b"this is not an image") is None
