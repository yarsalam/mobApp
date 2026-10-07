import json
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/conversion_model.pkl")
META_PATH = MODEL_PATH.replace(".pkl", "_meta.json")

FEATURE_NAMES = [
    "phase",
    "score",
    "is_explicit",
    "positive",
    "negative",
    "impact",
    "text_length",
    "hour",
    "day_of_week",
]

PHASE_THRESHOLDS = {1: 0.3, 2: 0.4, 3: 0.5}
MIN_TRAIN_SAMPLES = 10  # حداقل نمونه برای آموزش


class ConversionTrainer:
    def __init__(self):
        self.phase: int = 1
        self.feature_importance: Dict[str, float] = {}
        self._total_trained: int = 0
        self.conversion_model = self._load_or_create()

    # ── persistence ────────────────────────────────────────────────────────────

    def _load_or_create(self):
        # خواندن metadata از دیسک
        if os.path.exists(META_PATH):
            try:
                with open(META_PATH, "r") as f:
                    meta = json.load(f)
                self._total_trained = meta.get("training_count", 0)
                self.phase = meta.get("phase", 1)
                logger.info(
                    "Loaded meta: phase=%d total=%d", self.phase, self._total_trained
                )
            except Exception as exc:
                logger.warning("Could not load meta: %s", exc)

        if os.path.exists(MODEL_PATH):
            try:
                model = joblib.load(MODEL_PATH)
                logger.info("Model loaded from %s", MODEL_PATH)
                return model
            except Exception as exc:
                logger.warning("Could not load model: %s", exc)

        return RandomForestClassifier(
            n_estimators=200, max_depth=10, random_state=42, class_weight="balanced"
        )

    def _save(self) -> None:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        tmp = MODEL_PATH + ".tmp"
        joblib.dump(self.conversion_model, tmp)
        os.replace(tmp, MODEL_PATH)

        with open(META_PATH, "w") as f:
            json.dump(
                {
                    "training_count": self._total_trained,
                    "phase": self.phase,
                    "feature_importance": self.feature_importance,
                },
                f,
            )
        logger.info(
            "Model and meta saved (phase=%d total=%d)", self.phase, self._total_trained
        )

    # ── feature extraction ─────────────────────────────────────────────────────

    def extract_features(self, feedbacks: List[Dict]) -> np.ndarray:
        rows = []
        for fb in feedbacks:
            try:
                ts = (
                    datetime.fromisoformat(fb["createdAt"])
                    if fb.get("createdAt")
                    else datetime.now()
                )
            except ValueError:
                ts = datetime.now()
            rows.append(
                [
                    (fb.get("phase") or 0) / 3,
                    fb.get("value", {}).get("score", 0.5),
                    1 if fb.get("feedbackType") == "explicit" else 0,
                    1 if fb.get("sentiment") == "positive" else 0,
                    1 if fb.get("sentiment") == "negative" else 0,
                    fb.get("impactScore") or 0,
                    len(fb.get("metadata", {}).get("reason", "")) / 200,
                    ts.hour / 24,
                    ts.weekday() / 7,
                ]
            )
        return np.array(rows, dtype=np.float32)

    # ── training ───────────────────────────────────────────────────────────────

    def train(
        self,
        feedbacks: List[Dict],
        conversions: Optional[List] = None,
        revenues: Optional[List] = None,
    ) -> Dict:
        n = len(feedbacks)

        # حداقل نمونه لازم برای train_test_split
        if n < MIN_TRAIN_SAMPLES:
            logger.warning(
                "Not enough samples (%d < %d), skipping training", n, MIN_TRAIN_SAMPLES
            )
            return {
                "phase": self.phase,
                "accuracy": 0.0,
                "samples": n,
                "skipped": True,
                "reason": f"need at least {MIN_TRAIN_SAMPLES} samples",
            }

        self._total_trained += n
        X = self.extract_features(feedbacks)
        y_conv = (
            np.array(conversions, dtype=int)
            if conversions
            else np.array([1 if f.get("convertedToPurchase") else 0 for f in feedbacks])
        )

        # انتخاب مدل
        if self._total_trained < 5000:
            self.phase = 1
            self.conversion_model = RandomForestClassifier(
                n_estimators=200, max_depth=10, random_state=42, class_weight="balanced"
            )
        elif self._total_trained < 20000:
            self.phase = 2
            self.conversion_model = GradientBoostingClassifier(
                n_estimators=200, max_depth=8, learning_rate=0.1, random_state=42
            )
        else:
            self.phase = 3
            self.conversion_model = GradientBoostingClassifier(
                n_estimators=300, max_depth=8, learning_rate=0.05, random_state=42
            )

        logger.info(
            "Phase %d: training %d samples (total %d)",
            self.phase,
            n,
            self._total_trained,
        )

        stratify = y_conv if len(np.unique(y_conv)) > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_conv, test_size=0.2, random_state=42, stratify=stratify
        )

        self.conversion_model.fit(X_train, y_train)

        if (
            hasattr(self.conversion_model, "predict_proba")
            and len(np.unique(y_test)) > 1
        ):
            score = roc_auc_score(
                y_test, self.conversion_model.predict_proba(X_test)[:, 1]
            )
        else:
            score = float(self.conversion_model.score(X_test, y_test))

        if hasattr(self.conversion_model, "feature_importances_"):
            self.feature_importance = dict(
                zip(FEATURE_NAMES, self.conversion_model.feature_importances_)
            )

        self._save()
        return {
            "phase": self.phase,
            "accuracy": round(score, 4),
            "samples": n,
            "feature_importance": self.feature_importance,
        }

    # ── prediction ─────────────────────────────────────────────────────────────

    def predict_conversion_probability(self, feedback: Dict) -> Dict:
        X = self.extract_features([feedback])
        if hasattr(self.conversion_model, "predict_proba"):
            proba = float(self.conversion_model.predict_proba(X)[0][1])
        else:
            proba = float(self.conversion_model.predict(X)[0])
        confidence = min(0.5 + self._total_trained / 10000, 0.95)
        return {
            "probability": proba,
            "confidence": confidence,
            "phase": self.phase,
            "threshold": PHASE_THRESHOLDS.get(self.phase, 0.5),
        }

    def get_feature_importance(self) -> Dict:
        return self.feature_importance

    @property
    def training_count(self) -> int:
        return self._total_trained
