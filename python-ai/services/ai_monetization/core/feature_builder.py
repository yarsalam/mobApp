from __future__ import annotations

from math import isfinite
from typing import Any, Dict, List

import numpy as np


class FeatureBuilder:
    """Build the versioned feature contract for promotion scoring."""

    SCHEMA_VERSION = 2
    VARIANTS = ("vip", "boost", "credit", "profile", "bundle")
    VARIANT_ALIASES = {"credits": "credit"}

    FEATURE_NAMES = [
        "engagement_score",
        "days_since_signup_norm",
        "dismiss_rate",
        "last_purchase_days_norm",
        "swipe_velocity_norm",
        "promotion_ctr",
        "is_vip",
        "is_boost",
        "is_credit",
        "is_profile",
        "is_bundle",
        "hour_norm",
        "is_weekend",
        "session_depth_norm",
        "profile_incomplete",
    ]

    @classmethod
    def normalize_variant(cls, variant: str) -> str:
        if not isinstance(variant, str):
            raise ValueError("variant must be a string")
        normalized = cls.VARIANT_ALIASES.get(variant.strip().lower(), variant.strip().lower())
        if normalized not in cls.VARIANTS:
            raise ValueError(f"Unsupported promotion variant: {variant}")
        return normalized

    @staticmethod
    def _number(features: Dict[str, Any], key: str, default: float) -> float:
        value = features.get(key, default)
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"Feature {key} must be numeric")
        if not isfinite(number):
            raise ValueError(f"Feature {key} must be finite")
        return number

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return min(max(value, minimum), maximum)

    @classmethod
    def build_features(cls, features: Dict[str, Any], variant: str) -> np.ndarray:
        """Return a finite float32 row using schema version 2.

        The old conversion_score and avg_session_time fields are deliberately
        excluded: the current Backend supplies placeholder values for them.
        """
        if not isinstance(features, dict):
            raise ValueError("features must be an object")

        normalized_variant = cls.normalize_variant(variant)
        engagement = cls._clamp(cls._number(features, "engagement_score", 0.5), 0.0, 1.0)
        days_since_signup = cls._clamp(cls._number(features, "days_since_signup", 1.0), 0.0, 365.0)
        dismiss_rate = cls._clamp(cls._number(features, "dismiss_rate", 0.2), 0.0, 1.0)
        last_purchase_days = cls._clamp(cls._number(features, "last_purchase_days", 365.0), 0.0, 365.0)
        swipe_velocity = cls._clamp(cls._number(features, "swipe_velocity", 0.0), 0.0, 10.0)
        promotion_ctr = cls._clamp(cls._number(features, "promotion_ctr", 0.0), 0.0, 1.0)
        hour_of_day = cls._clamp(cls._number(features, "hour_of_day", 12.0), 0.0, 23.0)
        is_weekend = cls._clamp(cls._number(features, "is_weekend", 0.0), 0.0, 1.0)
        session_depth = cls._clamp(cls._number(features, "session_depth", 0.0), 0.0, 50.0)
        profile_incomplete = cls._clamp(cls._number(features, "profile_incomplete", 0.0), 0.0, 1.0)

        row = [
            engagement,
            days_since_signup / 365.0,
            dismiss_rate,
            last_purchase_days / 365.0,
            swipe_velocity / 10.0,
            promotion_ctr,
            1.0 if normalized_variant == "vip" else 0.0,
            1.0 if normalized_variant == "boost" else 0.0,
            1.0 if normalized_variant == "credit" else 0.0,
            1.0 if normalized_variant == "profile" else 0.0,
            1.0 if normalized_variant == "bundle" else 0.0,
            hour_of_day / 24.0,
            is_weekend,
            session_depth / 50.0,
            profile_incomplete,
        ]
        vector = np.asarray(row, dtype=np.float32)
        if vector.shape != (len(cls.FEATURE_NAMES),) or not np.isfinite(vector).all():
            raise ValueError("Feature vector does not match the active schema")
        return vector

    @classmethod
    def get_feature_names(cls) -> List[str]:
        return list(cls.FEATURE_NAMES)
