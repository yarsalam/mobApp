from __future__ import annotations

import builtins
import importlib.util
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai_uplift"
spec = importlib.util.spec_from_file_location(
    "uplift_model_under_test", SERVICE_ROOT / "core" / "uplift_model.py"
)
assert spec is not None and spec.loader is not None
uplift_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uplift_module)
UpliftModel = uplift_module.UpliftModel


def _model(tmp_path, monkeypatch):
    model_path = tmp_path / "uplift.pkl"
    monkeypatch.setattr(uplift_module, "MODEL_PATH", str(model_path))
    monkeypatch.setattr(uplift_module, "META_PATH", str(tmp_path / "uplift_meta.json"))
    return UpliftModel()


def _force_econml_unavailable(monkeypatch):
    real_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "econml" or name.startswith("econml."):
            raise ImportError("econml intentionally unavailable in contract test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)


def _training_frame():
    return pd.DataFrame({
        "treatment": [0, 0, 1, 1],
        "outcome": [1.0, 2.0, 3.0, 5.0],
        "feature_a": [0.1, 0.2, 0.3, 0.4],
    })


def test_missing_treatment_group_is_rejected(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    frame = _training_frame()
    frame["treatment"] = [0, 0, 0, 0]

    with pytest.raises(ValueError, match="two treated and two control"):
        model.train(frame, "treatment", "outcome", ["feature_a"])


def test_non_binary_treatment_is_rejected(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    frame = _training_frame()
    frame.loc[0, "treatment"] = 2

    with pytest.raises(ValueError, match="binary"):
        model.train(frame, "treatment", "outcome", ["feature_a"])


def test_non_finite_training_data_is_rejected(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    frame = _training_frame()
    frame.loc[0, "feature_a"] = np.nan

    with pytest.raises(ValueError, match="finite"):
        model.train(frame, "treatment", "outcome", ["feature_a"])


def test_econml_fallback_is_descriptive_and_never_claims_causality(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    _force_econml_unavailable(monkeypatch)

    result = model.train(_training_frame(), "treatment", "outcome", ["feature_a"])

    assert result["status"] == "trained_fallback"
    assert result["method"] == "group_mean_difference"
    assert result["effect_type"] == "descriptive_group_difference"
    assert result["causal_claim"] is False
    assert result["avg_uplift"] == 2.5
    assert result["confidence_interval"] is None
    assert result["interval_status"] == "not_calibrated"

    predicted = model.predict_uplift(np.array([[0.2], [0.8]], dtype=np.float32))
    assert predicted == [2.5, 2.5]


def test_fallback_metadata_survives_restart(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    _force_econml_unavailable(monkeypatch)
    model.train(_training_frame(), "treatment", "outcome", ["feature_a"])

    reloaded = UpliftModel()
    assert reloaded.trained is True
    assert reloaded._effect_type == "descriptive_group_difference"
    assert reloaded._treated_count == 2
    assert reloaded._control_count == 2
    assert reloaded.predict_uplift(np.array([[0.5]], dtype=np.float32)) == [2.5]


def test_invalid_prediction_matrix_is_rejected(tmp_path, monkeypatch):
    model = _model(tmp_path, monkeypatch)
    _force_econml_unavailable(monkeypatch)
    model.train(_training_frame(), "treatment", "outcome", ["feature_a"])

    with pytest.raises(ValueError, match="finite 2D"):
        model.predict_uplift(np.array([[np.nan]], dtype=np.float32))
