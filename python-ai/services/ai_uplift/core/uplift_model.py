import json
import logging
import os
from typing import Dict, List

import joblib
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("UPLIFT_MODEL_PATH", "/app/models/uplift_model.pkl")
META_PATH = MODEL_PATH.replace(".pkl", "_meta.json")


class UpliftModel:
    def __init__(self):
        self.model = None
        self.trained: bool = False
        self._avg_uplift: float = 0.0
        self._use_fallback: bool = False
        self._effect_type = "unavailable"
        self._treated_count = 0
        self._control_count = 0
        self._load()

    def _load(self) -> None:
        if os.path.exists(MODEL_PATH):
            try:
                data = joblib.load(MODEL_PATH)
                self.model = data.get("model")
                self.trained = self.model is not None
                logger.info("Uplift model loaded")
            except Exception as exc:
                logger.warning("Could not load uplift model: %s", exc)

        if os.path.exists(META_PATH):
            try:
                with open(META_PATH, "r", encoding="utf-8") as handle:
                    meta = json.load(handle)
                self._avg_uplift = float(meta.get("avg_uplift", 0.0))
                self._use_fallback = bool(meta.get("use_fallback", False))
                self._treated_count = int(meta.get("treated_count", 0))
                self._control_count = int(meta.get("control_count", 0))
                self._effect_type = meta.get(
                    "effect_type",
                    "legacy_descriptive_difference" if self._use_fallback
                    else "legacy_model_estimate_unverified",
                )
                if self._use_fallback:
                    if self._treated_count >= 2 and self._control_count >= 2:
                        self.trained = True
                        logger.info("Descriptive uplift fallback loaded")
                    else:
                        # Legacy fallback metadata did not record group counts;
                        # do not trust a possibly fabricated zero or mean difference.
                        self.trained = False
                        self._effect_type = "legacy_fallback_unverified"
                        logger.warning("Ignoring legacy uplift fallback without sample counts")
            except Exception as exc:
                logger.warning("Could not load uplift meta: %s", exc)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        if not self._use_fallback and self.model is not None:
            tmp = MODEL_PATH + ".tmp"
            joblib.dump({"model": self.model}, tmp)
            os.replace(tmp, MODEL_PATH)

        meta_tmp = META_PATH + ".tmp"
        with open(meta_tmp, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "avg_uplift": self._avg_uplift,
                    "use_fallback": self._use_fallback,
                    "effect_type": self._effect_type,
                    "treated_count": self._treated_count,
                    "control_count": self._control_count,
                },
                handle,
            )
        os.replace(meta_tmp, META_PATH)

    def train(
        self,
        df: pd.DataFrame,
        treatment_col: str,
        outcome_col: str,
        features: List[str],
    ) -> Dict:
        if treatment_col not in df.columns or outcome_col not in df.columns:
            raise ValueError(f"Columns '{treatment_col}' or '{outcome_col}' not found")
        if not features:
            raise ValueError("At least one feature column is required")
        missing = [feature for feature in features if feature not in df.columns]
        if missing:
            raise ValueError(f"Feature columns missing: {missing}")

        treatment = pd.to_numeric(df[treatment_col], errors="coerce").to_numpy(dtype=float)
        outcome = pd.to_numeric(df[outcome_col], errors="coerce").to_numpy(dtype=float)
        feature_matrix = df[features].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)

        if not np.isfinite(treatment).all() or not np.isfinite(outcome).all():
            raise ValueError("Treatment and outcome must contain only finite numeric values")
        if not np.isfinite(feature_matrix).all():
            raise ValueError("Features must contain only finite numeric values")
        if not set(np.unique(treatment)).issubset({0.0, 1.0}):
            raise ValueError("Treatment must be binary with values 0 or 1")

        self._treated_count = int(np.sum(treatment == 1))
        self._control_count = int(np.sum(treatment == 0))
        if self._treated_count < 2 or self._control_count < 2:
            raise ValueError("At least two treated and two control samples are required")

        treated_mean = float(np.mean(outcome[treatment == 1]))
        control_mean = float(np.mean(outcome[treatment == 0]))
        self._avg_uplift = treated_mean - control_mean

        try:
            from econml.dml import LinearDML
            from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor

            estimator = LinearDML(
                model_y=GradientBoostingRegressor(n_estimators=100, random_state=42),
                model_t=GradientBoostingClassifier(n_estimators=100, random_state=42),
                discrete_treatment=True,
                cv=2,
            )
            estimator.fit(outcome, treatment, X=feature_matrix)
            self.model = estimator
            self._use_fallback = False
            self._effect_type = "model_estimated_effect_unverified"
            self.trained = True
            self._save()
            return self._training_result(
                status="trained",
                method="LinearDML",
            )

        except ImportError:
            logger.warning("econml unavailable; retaining descriptive group difference only")
            self.model = None
            self._use_fallback = True
            self._effect_type = "descriptive_group_difference"
            self.trained = True
            self._save()
            return self._training_result(
                status="trained_fallback",
                method="group_mean_difference",
            )

    def _training_result(self, status: str, method: str) -> Dict:
        return {
            "status": status,
            "method": method,
            "effect_type": self._effect_type,
            "causal_claim": False,
            "causal_claim_reason": "Randomized assignment and causal identification were not verified by this API.",
            "samples": self._treated_count + self._control_count,
            "treated_count": self._treated_count,
            "control_count": self._control_count,
            "avg_uplift": round(self._avg_uplift, 4),
            "confidence_interval": None,
            "interval_status": "not_calibrated",
        }

    def predict_uplift(self, X: np.ndarray) -> List[float]:
        if not self.trained:
            raise ValueError("Model not trained yet")

        X_array = np.asarray(X, dtype=np.float32)
        if X_array.ndim != 2 or not np.isfinite(X_array).all():
            raise ValueError("Prediction features must be a finite 2D matrix")

        if self._use_fallback or self.model is None:
            # This is one descriptive group mean difference repeated for each row,
            # not an individualized or causally identified treatment effect.
            return [round(self._avg_uplift, 4)] * len(X_array)

        effects = self.model.effect(X_array)
        return [round(float(value), 4) for value in effects]
