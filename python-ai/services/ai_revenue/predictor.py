import logging
import os
from typing import Dict, List, Optional

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

MODEL_DIR = os.getenv("MODEL_DIR", "/app/models")
GB_MODEL_PATH = os.path.join(MODEL_DIR, "gb_model.pkl")

FEATURE_NAMES = [
    "channelType",
    "keywordDifficulty",
    "contentLength",
    "timeToConversion",
    "cityWeight",
    "intentScore",
    "engagementDepth",
    "retentionImpact",
    "campaignCost",
    "competitorPressure",
    "seasonalityFactor",
    "segmentSize",
]


class RevenuePredictor:
    def __init__(self):
        self.scaler = StandardScaler()
        self.feature_importance: Dict[str, float] = {}
        self._cv_score: float = 0.0
        self.gb_model = self._load_or_create()
        self.lstm_model = None

    def _load_or_create(self) -> GradientBoostingRegressor:
        if os.path.exists(GB_MODEL_PATH):
            try:
                data = joblib.load(GB_MODEL_PATH)
                self.scaler = data["scaler"]
                self.feature_importance = data.get("feature_importance", {})
                self._cv_score = data.get("cv_score", 0.0)
                logger.info("GB model loaded")
                return data["gb_model"]
            except Exception as exc:
                logger.warning("Could not load model: %s", exc)
        return GradientBoostingRegressor(
            n_estimators=200, max_depth=8, learning_rate=0.1, random_state=42
        )

    def _save(self) -> None:
        os.makedirs(MODEL_DIR, exist_ok=True)
        tmp = GB_MODEL_PATH + ".tmp"
        joblib.dump(
            {
                "gb_model": self.gb_model,
                "scaler": self.scaler,
                "feature_importance": self.feature_importance,
                "cv_score": self._cv_score,
            },
            tmp,
        )
        os.replace(tmp, GB_MODEL_PATH)

    def train_gb(self, X: np.ndarray, y: np.ndarray) -> Dict:
        if len(X) < 5:
            raise ValueError("Need at least 5 samples to train")

        X_scaled = self.scaler.fit_transform(X)
        self.gb_model.fit(X_scaled, y)

        # محاسبه confidence واقعی از طریق cross validation
        cv_scores = cross_val_score(
            self.gb_model, X_scaled, y, cv=min(5, len(X)), scoring="r2"
        )
        self._cv_score = float(np.clip(np.mean(cv_scores), 0, 1))

        self.feature_importance = dict(
            zip(FEATURE_NAMES, self.gb_model.feature_importances_)
        )
        self._save()
        logger.info("GB model trained, cv_r2=%.3f", self._cv_score)
        return {
            "feature_importance": self.feature_importance,
            "cv_score": self._cv_score,
        }

    def predict_ltv(self, features: List[float]) -> Dict:
        arr = np.asarray(features, dtype=np.float32)
        if arr.ndim != 1 or arr.size != len(FEATURE_NAMES) or not np.isfinite(arr).all():
            return self._fallback("invalid_features")

        if not hasattr(self.gb_model, "estimators_"):
            return self._fallback("model_not_trained")

        try:
            X_scaled = self.scaler.transform([arr])
            prediction = float(self.gb_model.predict(X_scaled)[0])

            if not np.isfinite(prediction) or prediction < 0 or prediction > 10_000:
                return self._fallback("prediction_out_of_range")

            return {
                "predicted_ltv": round(prediction, 2),
                "confidence": self._cv_score,  # CV score, not a calibrated probability
                "range": self._calculate_range(prediction),
                "fallback": False,
            }
        except Exception as exc:
            logger.error("Prediction failed: %s", exc)
            return self._fallback("prediction_error")

    @staticmethod
    def _calculate_range(prediction: float, margin: float = 0.15) -> List[float]:
        m = prediction * margin
        return [round(max(0.0, prediction - m), 2), round(prediction + m, 2)]

    @staticmethod
    def _fallback(reason: str) -> Dict:
        # Never manufacture an LTV estimate when the model is unavailable.
        # Callers can detect fallback=True and use a documented data-backed fallback.
        return {
            "predicted_ltv": None,
            "confidence": 0.0,
            "range": None,
            "fallback": True,
            "fallback_reason": reason,
        }
