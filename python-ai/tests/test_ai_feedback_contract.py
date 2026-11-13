from fastapi.testclient import TestClient

from services.ai_feedback.app import app

client = TestClient(app)


def feedback(**overrides):
    payload = {"userId": 991001, "feature": "promotion", "feedbackType": "click"}
    payload.update(overrides)
    return payload


def test_health_is_healthy_but_model_is_explicitly_unavailable():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["model_available"] is False
    assert body["training_enabled"] is False


def test_incremental_accepts_direct_feedback_without_claiming_training():
    response = client.post("/feedback/train_incremental", json=feedback())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "accepted_not_trained"
    assert body["trained"] == 0
    assert body["training_enabled"] is False


def test_incremental_accepts_legacy_feedback_envelope_safely():
    response = client.post(
        "/feedback/train_incremental", json={"feedback": feedback(feature="image")}
    )
    assert response.status_code == 200
    assert response.json()["trained"] == 0
    assert response.json()["feature"] == "image"


def test_batch_never_turns_missing_outcomes_into_negative_labels():
    response = client.post(
        "/feedback/train_batch",
        json=[feedback(), feedback(userId=991002, feedbackType="dismiss")],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["trained"] == 0
    assert body["samples_received"] == 2
    assert body["training_enabled"] is False


def test_prediction_fails_closed_without_validated_model():
    response = client.post("/feedback/predict", json=feedback())
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["probability"] is None
    assert detail["confidence"] is None
    assert detail["reason"] == "no_validated_conversion_model"


def test_metrics_never_report_fabricated_model_or_training_count():
    body = client.get("/feedback/metrics").json()
    assert body["model_available"] is False
    assert body["model_trained"] is False
    assert body["training_samples"] == 0
    assert body["training_enabled"] is False
