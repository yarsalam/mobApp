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
        self._load()

    def _load(self) -> None:
        if os.path.exists(MODEL_PATH):
            try:
                data = joblib.load(MODEL_PATH)
                self.model = data.get("model")
                self.trained = True
                logger.info("Uplift model loaded")
            except Exception as exc:
                logger.warning("Could not load uplift model: %s", exc)

        # بارگذاری meta (شامل avg_uplift برای fallback)
        if os.path.exists(META_PATH):
            try:
                with open(META_PATH, "r") as f:
                    meta = json.load(f)
                self._avg_uplift = meta.get("avg_uplift", 0.0)
                self._use_fallback = meta.get("use_fallback", False)
                if self._use_fallback:
                    self.trained = True
                    logger.info("Fallback uplift loaded: avg=%.4f", self._avg_uplift)
            except Exception as exc:
                logger.warning("Could not load uplift meta: %s", exc)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        if not self._use_fallback and self.model is not None:
            tmp = MODEL_PATH + ".tmp"
            joblib.dump({"model": self.model}, tmp)
            os.replace(tmp, MODEL_PATH)

        # ذخیره meta همیشه
        with open(META_PATH, "w") as f:
            json.dump(
                {
                    "avg_uplift": self._avg_uplift,
                    "use_fallback": self._use_fallback,
                },
                f,
            )

        logger.info(
            "Uplift model saved (fallback=%s, avg_uplift=%.4f)",
            self._use_fallback,
            self._avg_uplift,
        )

    def train(
        self,
        df: pd.DataFrame,
        treatment_col: str,
        outcome_col: str,
        features: List[str],
    ) -> Dict:
        if treatment_col not in df.columns or outcome_col not in df.columns:
            raise ValueError(f"Columns '{treatment_col}' or '{outcome_col}' not found")
        missing = [f for f in features if f not in df.columns]
        if missing:
            raise ValueError(f"Feature columns missing: {missing}")

        T = df[treatment_col].values
        Y = df[outcome_col].values
        X = df[features].values

        # محاسبه avg_uplift برای fallback (همیشه)
        treated_mean = float(Y[T == 1].mean()) if (T == 1).any() else 0.0
        control_mean = float(Y[T == 0].mean()) if (T == 0).any() else 0.0
        self._avg_uplift = treated_mean - control_mean

        try:
            from econml.dml import LinearDML
            from sklearn.ensemble import GradientBoostingRegressor

            model = LinearDML(
                model_y=GradientBoostingRegressor(n_estimators=100),
                model_t=GradientBoostingRegressor(n_estimators=100),
                discrete_treatment=True,
                cv=2,
            )
            model.fit(Y, T, X=X)
            self.model = model
            self._use_fallback = False
            self.trained = True
            self._save()
            return {
                "status": "trained",
                "samples": len(df),
                "avg_uplift": round(self._avg_uplift, 4),
            }

        except ImportError:
            logger.warning("econml not available, using mean-difference fallback")
            self._use_fallback = True
            self.trained = True
            self._save()
            return {
                "status": "trained_fallback",
                "samples": len(df),
                "avg_uplift": round(self._avg_uplift, 4),
            }

    def predict_uplift(self, X: np.ndarray) -> List[float]:
        if not self.trained:
            raise ValueError("Model not trained yet")

        if self._use_fallback or self.model is None:
            return [round(self._avg_uplift, 4)] * len(X)

        X_arr = np.asarray(X, dtype=np.float32)
        uplift = self.model.effect(X_arr)
        return [round(float(v), 4) for v in uplift]
