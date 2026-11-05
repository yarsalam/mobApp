from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai_revenue"
sys.path.insert(0, str(SERVICE_ROOT))

import app as revenue_app  # noqa: E402
from predictor import FEATURE_NAMES  # noqa: E402

client = TestClient(revenue_app.app)


def complete_payload():
    payload = {"userId": 123}
    payload["featureProvenance"] = {}
    for index, name in enumerate(FEATURE_NAMES):
        payload[name] = float(index + 1)
        payload["featureProvenance"][name] = {
            "status": "observed",
            "source": "synthetic-test-fixture",
            "asOf": "2026-11-05T00:00:00Z",
            "window": "test-window",
            "units": "test-unit",
            "transformation": "identity-test-fixture",
            "revision": revenue_app.FEATURE_REVISION,
        }
    return payload


def test_prediction_rejects_omitted_features_instead_of_using_numeric_defaults():
    response = client.post("/predict/ltv", json={"userId": 123})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "insufficient_data"
    assert set(detail["missing_features"]) == set(FEATURE_NAMES)


def test_prediction_rejects_values_without_complete_provenance():
    payload = complete_payload()
    payload["featureProvenance"].pop("campaignCost")

    response = client.post("/predict/ltv", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "insufficient_data",
        "missing_features": ["campaignCost"],
    }


def test_prediction_rejects_non_finite_feature_values():
    payload = complete_payload()
    payload["campaignCost"] = float("nan")

    response = client.post("/predict/ltv", json=payload)

    assert response.status_code == 422
    assert "campaignCost" in response.json()["detail"]["missing_features"]


def test_prediction_passes_only_complete_provenanced_features_to_model(monkeypatch):
    called = {}

    def fake_predict(features):
        called["features"] = features
        return {
            "predicted_ltv": 42.0,
            "confidence": None,
            "confidence_status": "not_calibrated",
            "cv_r2": None,
            "cv_strategy": "not_evaluated",
            "range": None,
            "prediction_interval": None,
            "interval_status": "not_calibrated",
            "fallback": False,
        }

    monkeypatch.setattr(revenue_app.predictor, "predict_ltv", fake_predict)
    response = client.post("/predict/ltv", json=complete_payload())

    assert response.status_code == 200
    assert response.json()["predicted_ltv"] == 42.0
    assert len(called["features"]) == len(FEATURE_NAMES)


def test_training_rejects_labeled_samples_with_missing_feature_provenance(monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("training must not run with incomplete features")

    monkeypatch.setattr(revenue_app.predictor, "train_gb", fail_if_called)
    payload = complete_payload()
    payload["actualLtv"] = 100.0
    payload["featureProvenance"].pop("retentionImpact")

    response = client.post("/train", json=[payload])

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "insufficient_data"
    assert "retentionImpact" in response.json()["detail"]["incomplete_samples"]["0"]
