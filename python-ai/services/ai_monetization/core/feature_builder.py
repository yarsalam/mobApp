import numpy as np
from datetime import datetime
from typing import Dict, List, Any

class FeatureBuilder:
    """ساخت feature vector برای مدل تبلیغات"""
    
    @staticmethod
    def build_features(features: Dict[str, Any], variant: str) -> np.ndarray:
        """
        تبدیل ویژگی‌های کاربر به feature vector
        """
        return np.array([
            features.get("engagement_score", 0.5),      # 0-1
            features.get("days_since_signup", 0),        # 0-∞
            features.get("dismiss_rate", 0.2),           # 0-1
            features.get("last_purchase_days", 999),     # 0-∞
            features.get("swipe_velocity", 0),           # 0-10
            features.get("avg_session_time", 0),         # 0-3600
            features.get("promotion_ctr", 0.1),          # 0-1
            features.get("conversion_score", 0.3),       # 0-1
            1 if variant == "vip" else 0,
            1 if variant == "boost" else 0,
            1 if variant == "credit" else 0,
            1 if variant == "profile" else 0,
            features.get("hour_of_day", 12) / 24,        # 0-1
            features.get("is_weekend", 0),               # 0/1
            features.get("session_depth", 1) / 50,       # 0-1
        ])
    
    @staticmethod
    def get_feature_names() -> List[str]:
        return [
            "engagement_score",
            "days_since_signup",
            "dismiss_rate",
            "last_purchase_days",
            "swipe_velocity",
            "avg_session_time",
            "promotion_ctr",
            "conversion_score",
            "is_vip",
            "is_boost",
            "is_credit",
            "is_profile",
            "hour_norm",
            "is_weekend",
            "session_depth_norm"
        ]