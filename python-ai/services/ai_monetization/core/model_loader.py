from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np

from core.feature_builder import FeatureBuilder

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("MODEL_PATH", "/app/models")
MODEL_FILENAME = "promotion_model_v1.pkl"


class ModelLoader:
    """Load only a schema-compatible, fitted promotion model.

    An absent or invalid model is an explicit state. No untrained estimator is
    constructed and heuristic priority scores are never described as probabilities.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._model = None
            cls._instance._status = "missing"
            cls._instance._artifact_info: Dict[str, Any] = {}
            cls._instance._load()
        return cls._instance

    def _load(self) -> None:
        model_file = Path(MODEL_PATH) / MODEL_FILENAME
        if not model_file.is_file():
            self._model = None
            self._status = "missing"
            logger.warning("No trained promotion model found; heuristic scoring is active")
            return

        try:
            import joblib

            artifact = joblib.load(model_file)
            if not isinstance(artifact, dict) or "model" not in artifact:
                raise ValueError("Legacy/unversioned model artifact is not accepted")
            if artifact.get("feature_schema_version") != FeatureBuilder.SCHEMA_VERSION:
                raise ValueError("Promotion model feature schema version mismatch")
            if artifact.get("feature_names") != FeatureBuilder.get_feature_names():
                raise ValueError("Promotion model feature names mismatch")

            model = artifact["model"]
            if not hasattr(model, "classes_") or not hasattr(model, "n_features_in_"):
                raise ValueError("Promotion model is not fitted")
            if int(model.n_features_in_) != len(FeatureBuilder.FEATURE_NAMES):
                raise ValueError("Promotion model feature count mismatch")
            if set(np.asarray(model.classes_).tolist()) != {0, 1}:
                raise ValueError("Promotion model must contain both binary classes")

            self._model = model
            self._status = "ready"
            self._artifact_info = {
                "trained_at": artifact.get("trained_at"),
                "training_samples": artifact.get("training_samples"),
                "experiment_ids": artifact.get("experiment_ids", []),
            }
            logger.info("Compatible promotion model loaded from %s", model_file)
        except Exception as exc:
            self._model = None
            self._status = "invalid"
            self._artifact_info = {"load_error": str(exc)}
            logger.error("Promotion model rejected: %s", exc)

    def get_model(self):
        return self._model

    def get_status(self) -> Dict[str, Any]:
        return {
            "model_status": self._status,
            "model_available": self._model is not None,
            "score_kind": "model_probability" if self._model is not None else "heuristic_priority",
            "feature_schema_version": FeatureBuilder.SCHEMA_VERSION,
            "feature_count": len(FeatureBuilder.FEATURE_NAMES),
            **self._artifact_info,
        }

    def score_candidates(self, features: np.ndarray) -> Tuple[np.ndarray, str]:
        matrix = np.asarray(features, dtype=np.float32)
        expected = len(FeatureBuilder.FEATURE_NAMES)
        if matrix.ndim != 2 or matrix.shape[1] != expected:
            raise ValueError(f"Expected a 2D feature matrix with {expected} columns")
        if not np.isfinite(matrix).all():
            raise ValueError("Feature matrix contains non-finite values")

        if self._model is not None:
            try:
                probabilities = np.asarray(self._model.predict_proba(matrix), dtype=np.float64)
                classes = list(np.asarray(self._model.classes_).tolist())
                positive_index = classes.index(1)
                scores = probabilities[:, positive_index]
                if scores.shape != (matrix.shape[0],) or not np.isfinite(scores).all():
                    raise ValueError("Model returned invalid promotion probabilities")
                return np.clip(scores, 0.0, 1.0), "model_probability"
            except Exception as exc:
                logger.error("Promotion model inference failed: %s", exc)
                raise RuntimeError("Trained promotion model inference failed") from exc

        return self._rule_based_score(matrix), "heuristic_priority"

    @staticmethod
    def _rule_based_score(features: np.ndarray) -> np.ndarray:
        """Transparent per-variant policy score, not a calibrated probability.

        Coefficients are deterministic prioritization policy. They must not be
        used as purchase probabilities or as training labels.
        """
        scores = []
        for row in features:
            engagement = float(row[0])
            tenure = float(row[1])
            dismiss_rate = float(row[2])
            purchase_recency = 1.0 - float(row[3])
            swipe_velocity = float(row[4])
            promotion_ctr = float(row[5])
            session_depth = float(row[13])
            profile_incomplete = float(row[14])

            components = {
                "vip": (
                    0.40 * engagement
                    + 0.25 * purchase_recency
                    + 0.20 * promotion_ctr
                    + 0.15 * tenure
                ),
                "boost": (
                    0.35 * swipe_velocity
                    + 0.25 * session_depth
                    + 0.20 * engagement
                    + 0.20 * (1.0 - dismiss_rate)
                ),
                "credit": (
                    0.35 * purchase_recency
                    + 0.25 * engagement
                    + 0.20 * swipe_velocity
                    + 0.20 * promotion_ctr
                ),
                "profile": (
                    0.55 * profile_incomplete
                    + 0.20 * (1.0 - engagement)
                    + 0.15 * session_depth
                    + 0.10 * (1.0 - dismiss_rate)
                ),
            }
            components["bundle"] = (
                components["vip"]
                + components["boost"]
                + components["credit"]
                + components["profile"]
            ) / 4.0

            variant_index = int(np.argmax(row[6:11]))
            variant = FeatureBuilder.VARIANTS[variant_index]
            scores.append(float(np.clip(components[variant], 0.0, 1.0)))

        return np.asarray(scores, dtype=np.float64)
