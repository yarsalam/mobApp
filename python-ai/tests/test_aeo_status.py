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

def _load_aeo_core():
    path = SERVICE_ROOT / "core" / "aeo_tracker.py"
    spec = importlib.util.spec_from_file_location("aeo_tracker_under_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.AEOVisibilityTracker


AEOVisibilityTracker = _load_aeo_core()


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
    # app.py uses the runtime import path "core.aeo_tracker". Temporarily map
    # that package to this service and restore the Matching package afterwards.
    previous_core = sys.modules.get("core")
    previous_aeo_core = sys.modules.get("core.aeo_tracker")
    core_package = types.ModuleType("core")
    core_package.__path__ = [str(SERVICE_ROOT / "core")]
    sys.modules["core"] = core_package
    tracker_path = SERVICE_ROOT / "core" / "aeo_tracker.py"
    tracker_spec = importlib.util.spec_from_file_location("core.aeo_tracker", tracker_path)
    assert tracker_spec is not None and tracker_spec.loader is not None
    tracker_module = importlib.util.module_from_spec(tracker_spec)
    sys.modules["core.aeo_tracker"] = tracker_module
    tracker_spec.loader.exec_module(tracker_module)

    path = SERVICE_ROOT / "app.py"
    spec = importlib.util.spec_from_file_location("aeo_app_under_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    if previous_core is None:
        sys.modules.pop("core", None)
    else:
        sys.modules["core"] = previous_core
    if previous_aeo_core is None:
        sys.modules.pop("core.aeo_tracker", None)
    else:
        sys.modules["core.aeo_tracker"] = previous_aeo_core
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


class CitationProvider:
    name = "perplexity"

    async def ask(self, prompt: str) -> str:
        return "Example Brand is mentioned positively."

    async def ask_with_metadata(self, prompt: str) -> dict:
        return {
            "text": "Example Brand is mentioned positively.",
            "citations": ["https://example.com/source"],
            "model": "sonar",
        }


def test_perplexity_adapter_extracts_citations_from_api_response(monkeypatch):
    providers_path = SERVICE_ROOT / "core" / "providers.py"
    spec = importlib.util.spec_from_file_location("aeo_providers_adapter_test", providers_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class FakeResponse:
        model = "sonar"

        def __init__(self):
            self.choices = [types.SimpleNamespace(
                message=types.SimpleNamespace(content="Example Brand appears in the answer.")
            )]
            self.citations = ["https://example.com/source"]

        def model_dump(self):
            return {"citations": self.citations}

    class FakeCompletions:
        async def create(self, **kwargs):
            self.kwargs = kwargs
            return FakeResponse()

    fake_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=FakeCompletions())
    )
    constructor_kwargs = {}
    def fake_async_openai(**kwargs):
        constructor_kwargs.update(kwargs)
        return fake_client

    monkeypatch.setattr(module, "AsyncOpenAI", fake_async_openai)
    provider = module.PerplexityProvider(api_key="test-key")

    result = asyncio.run(provider.ask_with_metadata("prompt"))

    assert result["text"] == "Example Brand appears in the answer."
    assert result["citations"] == ["https://example.com/source"]
    assert result["model"] == "sonar"
    assert fake_client.chat.completions.kwargs["model"] == "sonar"
    assert constructor_kwargs["max_retries"] == 0
    assert constructor_kwargs["timeout"] == 20.0


def test_aeo_cache_key_changes_when_provider_model_changes():
    class ModelProvider:
        name = "perplexity"
        model = "sonar"

        async def ask(self, prompt: str) -> str:
            return "Example Brand"

    provider = ModelProvider()
    tracker = AEOVisibilityTracker(provider=provider, redis_client=None)
    first = tracker._cache_key("Example Brand", "prompt")
    provider.model = "sonar-pro"
    second = tracker._cache_key("Example Brand", "prompt")

    assert first != second


def test_provider_citations_and_model_are_preserved():
    tracker = AEOVisibilityTracker(provider=CitationProvider(), redis_client=None)
    result = asyncio.run(
        tracker._call_with_retry("Example Brand", "prompt", "prompt", attempts=1)
    )

    assert result["engine"] == "perplexity"
    assert result["model"] == "sonar"
    assert result["citations"] == ["https://example.com/source"]
    assert result["mentioned"] is True


def test_multi_engine_rates_are_separate_not_combined(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-perplexity-key")
    app = _load_app()

    async def openai_results(*args, **kwargs):
        return [{"engine": "openai", "status": "ok", "mentioned": True}]

    async def perplexity_results(*args, **kwargs):
        return [{"engine": "perplexity", "status": "ok", "mentioned": False}]

    monkeypatch.setattr(app.tracker, "check_mentions", openai_results)
    monkeypatch.setattr(app.perplexity_tracker, "check_mentions", perplexity_results)
    request = app.MentionRequest(
        brand="Example Brand",
        prompts=["one"],
        engines=[" OPENAI ", "Perplexity"],
    )
    result = asyncio.run(app.check_mentions(request))

    assert result["status"] == "ok"
    assert result["mention_rate"] is None
    assert result["mention_rate_by_engine"]["openai"]["mention_rate"] == 1.0
    assert result["mention_rate_by_engine"]["perplexity"]["mention_rate"] == 0.0
    assert {item["engine"] for item in result["results"]} == {"openai", "perplexity"}


def test_request_defaults_to_all_configured_engines(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-perplexity-key")
    app = _load_app()

    async def openai_results(*args, **kwargs):
        return [{"engine": "openai", "status": "ok", "mentioned": True}]

    async def perplexity_results(*args, **kwargs):
        return [{"engine": "perplexity", "status": "ok", "mentioned": True}]

    monkeypatch.setattr(app.tracker, "check_mentions", openai_results)
    monkeypatch.setattr(app.perplexity_tracker, "check_mentions", perplexity_results)
    request = app.MentionRequest(brand="Example Brand", prompts=["one"])
    result = asyncio.run(app.check_mentions(request))

    assert result["engines"] == ["openai", "perplexity"]
    assert result["mention_rate"] is None
    assert result["mention_rate_by_engine"]["openai"]["mention_rate"] == 1.0
    assert result["mention_rate_by_engine"]["perplexity"]["mention_rate"] == 1.0


def test_unconfigured_engine_is_unavailable_not_negative(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    app = _load_app()
    request = app.MentionRequest(
        brand="Example Brand",
        prompts=["one"],
        engines=["perplexity"],
    )

    response = asyncio.run(app.check_mentions(request))
    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload["status"] == "unavailable"
    assert payload["mention_rate"] is None
    assert payload["results"][0]["mentioned"] is None
    assert payload["results"][0]["error_code"] == "provider_not_configured"


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


def test_aeo_history_isolated_by_engine_and_migrates_only_tagged_legacy_results():
    legacy_snapshot = {
        "date": "2026-11-04",
        "sample_count": 2,
        "available_count": 2,
        "unavailable_count": 0,
        "mention_rate": 0.5,
        "results": [
            {"engine": "openai", "model": "gpt-4o-mini", "status": "ok", "mentioned": True},
            {"engine": "perplexity", "model": "sonar", "status": "ok", "mentioned": False},
            {"model": "legacy-unknown", "status": "ok", "mentioned": True},
        ],
    }
    redis = FakeRedis({
        "aeo:history:Example Brand": json.dumps([legacy_snapshot]),
    })
    openai_provider = types.SimpleNamespace(name="openai", model="gpt-4o-mini")
    perplexity_provider = types.SimpleNamespace(name="perplexity", model="sonar")
    openai_tracker = AEOVisibilityTracker(provider=openai_provider, redis_client=redis)
    perplexity_tracker = AEOVisibilityTracker(provider=perplexity_provider, redis_client=redis)

    openai_history = openai_tracker.get_history("Example Brand")
    perplexity_history = perplexity_tracker.get_history("Example Brand")

    assert openai_history[0]["engine"] == "openai"
    assert openai_history[0]["sample_count"] == 1
    assert openai_history[0]["mention_rate"] == 1.0
    assert [item["engine"] for item in openai_history[0]["results"]] == ["openai"]
    assert perplexity_history[0]["engine"] == "perplexity"
    assert perplexity_history[0]["sample_count"] == 1
    assert perplexity_history[0]["mention_rate"] == 0.0
    assert [item["engine"] for item in perplexity_history[0]["results"]] == ["perplexity"]
    assert "aeo:history:Example Brand:openai" in redis.values
    assert "aeo:history:Example Brand:perplexity" in redis.values


def test_aeo_snapshot_writes_engine_and_model_specific_history_key():
    redis = FakeRedis()
    provider = types.SimpleNamespace(name="perplexity", model="sonar-pro")
    tracker = AEOVisibilityTracker(provider=provider, redis_client=redis)
    tracker._save_snapshot("Example Brand", [
        {"engine": "perplexity", "model": "sonar-pro", "status": "ok", "mentioned": True}
    ])

    key = "aeo:history:Example Brand:perplexity"
    assert key in redis.values
    snapshot = json.loads(redis.values[key])[0]
    assert snapshot["engine"] == "perplexity"
    assert snapshot["model"] == "sonar-pro"
    assert snapshot["mention_rate"] == 1.0


def test_history_endpoint_supports_engine_query_and_rejects_unknown_engine(monkeypatch):
    app = _load_app()
    monkeypatch.setattr(
        app.perplexity_tracker,
        "get_history",
        lambda brand: [{"engine": "perplexity", "model": "sonar"}],
    )

    result = asyncio.run(app.get_history("Example Brand", engine="PERPLEXITY"))
    assert result["engine"] == "perplexity"
    assert result["history"][0]["engine"] == "perplexity"

    with pytest.raises(app.HTTPException) as exc:
        asyncio.run(app.get_history("Example Brand", engine="gemini"))
    assert exc.value.status_code == 422
