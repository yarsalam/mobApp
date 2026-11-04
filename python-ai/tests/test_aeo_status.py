from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai_aeo_tracker"
sys.path.insert(0, str(SERVICE_ROOT))

# The tests inject a fake provider and never call OpenAI. Keep the module import
# lightweight in the CI regression environment where the SDK is not installed.
if "openai" not in sys.modules:
    openai_stub = types.ModuleType("openai")

    class DummyAsyncOpenAI:
        def __init__(self, *args, **kwargs):
            pass

    openai_stub.AsyncOpenAI = DummyAsyncOpenAI
    sys.modules["openai"] = openai_stub

from core.aeo_tracker import AEOVisibilityTracker


class FakeRedis:
    def __init__(self, values=None):
        self.values = values or {}
        self.setex_calls = []

    def get(self, key):
        return self.values.get(key)

    def setex(self, key, ttl, value):
        self.setex_calls.append((key, ttl, value))
        self.values[key] = value


class FailingProvider:
    name = "openai"

    async def ask(self, prompt: str) -> str:
        raise RuntimeError("provider temporarily unavailable")


def _load_app():
    path = SERVICE_ROOT / "app.py"
    spec = importlib.util.spec_from_file_location("aeo_app_under_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_provider_failure_is_unavailable_not_a_negative_mention():
    tracker = AEOVisibilityTracker(provider=FailingProvider(), redis_client=None)
    result = asyncio.run(
        tracker._call_with_retry("Example Brand", "prompt", "prompt", attempts=1)
    )

    assert result["status"] == "unavailable"
    assert result["mentioned"] is None
    assert result["error_code"] == "provider_unavailable"
    assert "error" not in result


def test_unavailable_provider_result_is_not_cached(monkeypatch):
    redis = FakeRedis()
    tracker = AEOVisibilityTracker(provider=FailingProvider(), redis_client=redis)

    async def unavailable(*args, **kwargs):
        return {
            "prompt": "prompt",
            "engine": "openai",
            "status": "unavailable",
            "mentioned": None,
            "error_code": "provider_unavailable",
        }

    monkeypatch.setattr(tracker, "_call_with_retry", unavailable)
    result = asyncio.run(tracker._check_single("Example Brand", "prompt"))

    assert result["status"] == "unavailable"
    assert redis.setex_calls == []


def test_legacy_cached_failure_is_not_read_as_not_mentioned():
    redis = FakeRedis()
    tracker = AEOVisibilityTracker(provider=FailingProvider(), redis_client=redis)
    prompt = "Example Brand prompt"
    rendered = prompt.replace("{brand}", "Example Brand")
    cache_key = tracker._cache_key("Example Brand", rendered)
    redis.values[cache_key] = json.dumps({
        "prompt": prompt,
        "engine": "openai",
        "mentioned": False,
        "error": "legacy provider failure",
    })

    result = asyncio.run(tracker._check_single("Example Brand", prompt))

    assert result["status"] == "unavailable"
    assert result["mentioned"] is None


def test_history_mention_rate_excludes_unavailable_results():
    redis = FakeRedis()
    tracker = AEOVisibilityTracker(provider=FailingProvider(), redis_client=redis)
    tracker._save_snapshot("Example Brand", [
        {"status": "ok", "mentioned": True},
        {"status": "unavailable", "mentioned": None},
        {"status": "ok", "mentioned": False},
    ])

    key = "aeo:history:Example Brand"
    snapshot = json.loads(redis.values[key])[0]
    assert snapshot["status"] == "partial"
    assert snapshot["sample_count"] == 3
    assert snapshot["available_count"] == 2
    assert snapshot["unavailable_count"] == 1
    assert snapshot["mention_rate"] == 0.5


def test_api_reports_partial_provider_failures_without_polluting_rate(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    app = _load_app()

    async def fake_check_mentions(*args, **kwargs):
        return [
            {"status": "ok", "mentioned": True},
            {"status": "unavailable", "mentioned": None},
            {"status": "ok", "mentioned": False},
        ]

    monkeypatch.setattr(app.tracker, "check_mentions", fake_check_mentions)
    request = app.MentionRequest(brand="Example Brand", prompts=["one", "two", "three"])
    result = asyncio.run(app.check_mentions(request))

    assert result["status"] == "partial"
    assert result["sample_count"] == 3
    assert result["available_count"] == 2
    assert result["unavailable_count"] == 1
    assert result["mention_rate"] == 0.5


def test_api_returns_503_when_no_provider_result_is_available(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    app = _load_app()

    async def fake_check_mentions(*args, **kwargs):
        return [
            {"status": "unavailable", "mentioned": None},
            {"status": "unavailable", "mentioned": None},
        ]

    monkeypatch.setattr(app.tracker, "check_mentions", fake_check_mentions)
    request = app.MentionRequest(brand="Example Brand", prompts=["one", "two"])
    response = asyncio.run(app.check_mentions(request))

    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload["status"] == "unavailable"
    assert payload["mention_rate"] is None
    assert payload["available_count"] == 0
