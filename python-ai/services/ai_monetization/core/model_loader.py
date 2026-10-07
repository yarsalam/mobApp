import logging
import os
from pathlib import Path
from typing import List

import numpy as np

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("MODEL_PATH", "/app/models")


class ModelLoader:
    """Singleton — مدل را فقط یک بار لود می‌کند."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._model = None
            cls._instance._load()
        return cls._instance

    def _load(self) -> None:
        model_file = Path(MODEL_PATH) / "promotion_model_v1.pkl"
        if model_file.exists():
            try:
                import joblib

                self._model = joblib.load(model_file)
                logger.info("Model loaded from %s", model_file)
                return
            except Exception as exc:
                logger.warning("Could not load model: %s", exc)

        try:
            from sklearn.linear_model import LogisticRegression

            self._model = LogisticRegression(
                C=1.0, class_weight="balanced", random_state=42
            )
            logger.warning("No trained model found, using untrained baseline")
        except ImportError:
            logger.error("sklearn not available")

    def get_model(self):
        return self._model

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        if self._model is not None:
            try:
                return self._model.predict_proba(features)
            except Exception as exc:
                logger.warning("Model prediction failed: %s", exc)
        return self._rule_based_score(features)

    @staticmethod
    def _rule_based_score(features: np.ndarray) -> np.ndarray:
        scores = []
        for f in features:
            score = float(
                f[0] * 0.3 + max(0.0, 1 - f[3] / 100) * 0.2 + f[6] * 0.3 + 0.2
            )
            score = min(max(score, 0.0), 1.0)
            scores.append([1 - score, score])
        return np.array(scores)
