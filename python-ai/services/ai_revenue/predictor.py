import logging
import os
from typing import Dict, List, Optional

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import KFold, cross_val_score
from sklearn.pipeline import Pipeline
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
        self._cv_score: Optional[float] = None
        self._cv_strategy = "not_evaluated"
        self.gb_model = self._load_or_create()
        self.lstm_model = None

    def _load_or_create(self) -> GradientBoostingRegressor:
        if os.path.exists(GB_MODEL_PATH):
            try:
                data = joblib.load(GB_MODEL_PATH)
                self.scaler = data["scaler"]
                self.feature_importance = data.get("feature_importance", {})
                loaded_cv = data.get("cv_score")
                self._cv_score = (
                    float(loaded_cv)
                    if loaded_cv is not None and np.isfinite(float(loaded_cv))
                    else None
                )
                self._cv_strategy = data.get("cv_strategy", "legacy_unknown")
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
                "cv_strategy": self._cv_strategy,
            },
            tmp,
        )
        os.replace(tmp, GB_MODEL_PATH)

    def train_gb(self, X: np.ndarray, y: np.ndarray) -> Dict:
        X_array = np.asarray(X, dtype=np.float32)
        y_array = np.asarray(y, dtype=np.float32).reshape(-1)
        if X_array.ndim != 2 or X_array.shape[1] != len(FEATURE_NAMES):
            raise ValueError(f"Expected a 2D feature matrix with {len(FEATURE_NAMES)} columns")
        if y_array.ndim != 1 or len(y_array) != len(X_array):
            raise ValueError("Feature and target sample counts must match")
        if len(X_array) < 5:
            raise ValueError("Need at least 5 samples to train")
        if not np.isfinite(X_array).all() or not np.isfinite(y_array).all():
            raise ValueError("Training data must contain only finite values")

        # Fit preprocessing inside each CV fold. Scaling the full dataset before
        # cross-validation leaks information from validation folds into training.
        self._cv_score = None
        cv_status = "insufficient_samples"
        cv_strategy = "not_evaluated"
        if len(X_array) >= 10:
            cv_strategy = "random_kfold_5"
            cv_pipeline = Pipeline([
                ("scaler", StandardScaler()),
                ("model", GradientBoostingRegressor(
                    n_estimators=200,
                    max_depth=8,
                    learning_rate=0.1,
                    random_state=42,
                )),
            ])
            cv_scores = cross_val_score(
                cv_pipeline,
                X_array,
                y_array,
                cv=KFold(n_splits=5, shuffle=True, random_state=42),
                scoring="r2",
            )
            valid_scores = cv_scores[np.isfinite(cv_scores)]
            if valid_scores.size:
                self._cv_score = float(np.mean(valid_scores))
                cv_status = "evaluated"

        # Fit the final inference scaler/model on the full training set only
        # after cross-validation has completed.
        X_scaled = self.scaler.fit_transform(X_array)
        self.gb_model.fit(X_scaled, y_array)

        self._cv_strategy = cv_strategy
        self.feature_importance = dict(
            zip(FEATURE_NAMES, self.gb_model.feature_importances_)
        )
        self._save()
        logger.info("GB model trained, cv_r2=%s", self._cv_score)
        return {
            "feature_importance": self.feature_importance,
            "cv_r2": self._cv_score,
            "cv_score": self._cv_score,  # backward-compatible alias; not confidence
            "cv_status": cv_status,
            "cv_strategy": cv_strategy,
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
                "confidence": None,
                "confidence_status": "not_calibrated",
                "cv_r2": self._cv_score,
                "cv_strategy": self._cv_strategy,
                "range": None,
                "prediction_interval": None,
                "interval_status": "not_calibrated",
                "fallback": False,
            }
        except Exception as exc:
            logger.error("Prediction failed: %s", exc)
            return self._fallback("prediction_error")

    @staticmethod
    def _fallback(reason: str) -> Dict:
        # Never manufacture an LTV estimate or a confidence interval.
        return {
            "predicted_ltv": None,
            "confidence": None,
            "confidence_status": "not_calibrated",
            "cv_r2": None,
            "cv_strategy": "not_evaluated",
            "range": None,
            "prediction_interval": None,
            "interval_status": "not_calibrated",
            "fallback": True,
            "fallback_reason": reason,
        }
