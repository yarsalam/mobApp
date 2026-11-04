from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "services" / "ml_service"
sys.path.insert(0, str(SERVICE_ROOT))


def _load_with_matching_packages(path: Path, module_name: str):
    # Other service tests also use a top-level "core" package. Isolate this
    # service's import roots so test collection order cannot cross-wire modules.
    previous = {
        name: module for name, module in list(sys.modules.items())
        if name == "core" or name.startswith("core.")
        or name == "services" or name.startswith("services.")
    }
    for name in previous:
        sys.modules.pop(name, None)

    core_package = types.ModuleType("core")
    core_package.__path__ = [str(SERVICE_ROOT / "core")]
    services_package = types.ModuleType("services")
    services_package.__path__ = [str(SERVICE_ROOT / "services")]
    sys.modules["core"] = core_package
    sys.modules["services"] = services_package

    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    for name in list(sys.modules):
        if name == "core" or name.startswith("core.")
        or name == "services" or name.startswith("services."):
            sys.modules.pop(name, None)
    sys.modules.update(previous)
    return module


recommendation_module = _load_with_matching_packages(
    SERVICE_ROOT / "services" / "recommendation.py",
    "matching_recommendation_under_test",
)
RecommendationService = recommendation_module.RecommendationService


class FakeRedis:
    def __init__(self, values=None):
        self.values = values or {}

    async def mget(self, keys):
        return [self.values.get(key) for key in keys]

    async def get(self, key):
        return self.values.get(key)


class FakeEmbeddingClient:
    async def get_embedding(self, text):
        return None


def _service(values=None):
    return RecommendationService(FakeEmbeddingClient(), FakeRedis(values))


def test_cold_start_never_invents_candidate_ids_or_scores():
    service = _service()
    result = asyncio.run(service.get_recommendations(1, [2, 3], limit=5))

    assert result["status"] == "insufficient_data"
    assert result["fallback"] == "none"
    assert result["recommendations"] == []


def test_cold_start_uses_only_observed_popularity_within_candidate_set():
    redis_values = {
        "cache:popular_users": json.dumps([
            {"user_id": 9, "score": 0.99},
            {"user_id": 2, "score": 0.82},
            {"user_id": 3, "score": 0.71},
        ])
    }
    service = _service(redis_values)
    result = asyncio.run(service.get_recommendations(1, [2], limit=5))

    assert result["status"] == "ok"
    assert result["fallback"] == "observed_popularity"
    assert [item["user_id"] for item in result["recommendations"]] == [2]
    assert result["recommendations"][0]["score"] == 0.82


def test_missing_revenue_and_engagement_are_not_replaced_with_constants():
    redis_values = {
        "emb:user:1": json.dumps([1.0, 0.0]),
        "emb:user:2": json.dumps([1.0, 0.0]),
    }
    service = _service(redis_values)
    result = asyncio.run(service.get_recommendations(1, [2], limit=5))

    recommendation = result["recommendations"][0]
    assert recommendation["score"] == 1.0
    assert recommendation["score_type"] == "similarity_only"
    assert recommendation["similarity"] == 1.0
    assert recommendation["revenue_potential"] is None
    assert recommendation["score_components"] == {"embedding": 1.0}
    assert "engagement" not in recommendation["score_components"]


def test_only_observed_revenue_signal_contributes_to_weighted_score():
    redis_values = {
        "emb:user:1": json.dumps([1.0, 0.0]),
        "emb:user:2": json.dumps([0.0, 1.0]),
        "revenue:potential:2": "0.8",
    }
    service = _service(redis_values)
    result = asyncio.run(service.get_recommendations(1, [2], limit=5))

    recommendation = result["recommendations"][0]
    assert recommendation["score_type"] == "weighted_observed_features"
    assert recommendation["score_components"] == {"embedding": 0.0, "revenue": 0.8}
    assert recommendation["score"] == pytest.approx(0.2222, abs=0.0001)


def test_zero_or_missing_embeddings_do_not_produce_a_match_score():
    service = _service({
        "emb:user:1": json.dumps([0.0, 0.0]),
        "emb:user:2": json.dumps([1.0, 0.0]),
    })
    result = asyncio.run(service.get_recommendations(1, [2], limit=5))
    assert result["status"] == "insufficient_data"
    assert result["recommendations"] == []

    missing = _service()
    assert asyncio.run(missing.predict_match_score(1, 2)) is None


def test_predict_route_returns_503_when_match_score_is_unavailable(monkeypatch):
    path = SERVICE_ROOT / "routes" / "matching.py"
    module = _load_with_matching_packages(path, "matching_routes_under_test")

    async def unavailable(*args, **kwargs):
        return None

    monkeypatch.setattr(module.rec_service, "predict_match_score", unavailable)
    payload = module.PredictIn(user_a=1, user_b=2)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(module.predict_match(payload))
    assert exc.value.status_code == 503
