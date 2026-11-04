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


# URL audit uses a bounded HTML parser and rejects obviously unsafe destinations
# without issuing network requests in the test suite.
import socket as _socket
sys.path.insert(0, str(ROOT / "services" / "ai_seo"))
import api.url_audit as url_audit


def test_url_audit_syntax_accepts_public_http_url_and_drops_fragment():
    result = url_audit.validate_url_syntax("https://example.com/products#details")
    assert result == "https://example.com/products"


def test_url_audit_rejects_non_http_credentials_private_ip_and_nonstandard_port():
    invalid_urls = [
        "file:///etc/passwd",
        "https://user:password@example.com/",
        "http://127.0.0.1/",
        "http://localhost/",
        "http://192.168.1.10/",
        "https://example.com:8443/",
    ]
    for url in invalid_urls:
        try:
            url_audit.validate_url_syntax(url)
        except url_audit.UnsafeTargetError:
            continue
        raise AssertionError(f"Unsafe URL was accepted: {url}")


def test_url_audit_dns_guard_rejects_private_dns_answers(monkeypatch):
    def private_answer(host, port, family, socktype):
        return [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))]

    monkeypatch.setattr(url_audit.socket, "getaddrinfo", private_answer)
    try:
        asyncio.run(url_audit._resolve_and_check_public_target("https://example.com/"))
    except url_audit.UnsafeTargetError as exc:
        assert "non-public" in str(exc)
    else:
        raise AssertionError("DNS answer resolving to a private IP was accepted")


def test_url_audit_html_extraction_returns_checklist_not_raw_html():
    html = """<!doctype html>
    <html lang="fa"><head>
      <title>راهنمای انتخاب محصول مناسب برای مشتریان</title>
      <meta name="description" content="راهنمای کامل انتخاب محصول مناسب برای مشتریان عزیز و مقایسه گزینه‌ها">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="/guide">
    </head><body>
      <h1>راهنمای محصول</h1>
      <img src="/one.jpg"><img src="/two.jpg" alt="تصویر دوم">
      <a href="/about">درباره ما</a><a href="https://other.example/page">لینک بیرونی</a>
    </body></html>"""
    result = url_audit.extract_html_audit(
        html,
        "https://example.com/guide",
        200,
        {"content-type": "text/html; charset=utf-8"},
    )
    assert result["status_code"] == 200
    assert result["title"] == "راهنمای انتخاب محصول مناسب برای مشتریان"
    assert result["canonical"] == "https://example.com/guide"
    assert result["language"] == "fa"
    assert result["h1_count"] == 1
    assert result["image_count"] == 2
    assert result["images_missing_alt"] == 1
    assert result["internal_links"] == 1
    assert result["external_links"] == 1
    assert result["score_type"] == "heuristic_on_page_checklist_not_google_ranking"
    assert "body" not in result and "html" not in result
