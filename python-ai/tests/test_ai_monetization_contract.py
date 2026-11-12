import os
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from core.feature_builder import FeatureBuilder
from core.model_loader import ModelLoader


class MonetizationFeatureContractTests(unittest.TestCase):
    def setUp(self):
        ModelLoader._instance = None

    def tearDown(self):
        ModelLoader._instance = None

    def sample_features(self):
        return {
            "engagement_score": 0.8,
            "days_since_signup": 30,
            "dismiss_rate": 0.1,
            "last_purchase_days": 7,
            "swipe_velocity": 3,
            "promotion_ctr": 0.15,
            "hour_of_day": 18,
            "is_weekend": 0,
            "session_depth": 12,
            "profile_incomplete": 0,
            # These old placeholders must not affect schema-v2 features.
            "avg_session_time": 180,
            "conversion_score": 0.3,
        }

    def test_every_supported_variant_has_a_distinct_one_hot_vector(self):
        rows = [
            FeatureBuilder.build_features(self.sample_features(), variant)
            for variant in FeatureBuilder.VARIANTS
        ]
        self.assertEqual(rows[0].shape, (len(FeatureBuilder.FEATURE_NAMES),))
        self.assertEqual(len({row.tobytes() for row in rows}), len(FeatureBuilder.VARIANTS))
        for index, row in enumerate(rows):
            self.assertEqual(float(row[6:11].sum()), 1.0)
            self.assertEqual(int(np.argmax(row[6:11])), index)

    def test_credits_alias_maps_to_credit(self):
        credit = FeatureBuilder.build_features(self.sample_features(), "credit")
        credits = FeatureBuilder.build_features(self.sample_features(), "credits")
        np.testing.assert_array_equal(credit, credits)

    def test_unsupported_variant_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unsupported promotion variant"):
            FeatureBuilder.build_features(self.sample_features(), "mystery")

    def test_non_finite_feature_is_rejected(self):
        features = self.sample_features()
        features["engagement_score"] = float("nan")
        with self.assertRaisesRegex(ValueError, "must be finite"):
            FeatureBuilder.build_features(features, "vip")

    def test_missing_model_uses_variant_specific_heuristic_not_untrained_estimator(self):
        with tempfile.TemporaryDirectory() as model_dir:
            with patch("core.model_loader.MODEL_PATH", model_dir):
                ModelLoader._instance = None
                loader = ModelLoader()

                self.assertIsNone(loader.get_model())
                self.assertEqual(loader.get_status()["model_status"], "missing")
                self.assertEqual(loader.get_status()["score_kind"], "heuristic_priority")

                rows = np.vstack([
                    FeatureBuilder.build_features(self.sample_features(), variant)
                    for variant in FeatureBuilder.VARIANTS
                ])
                scores, score_kind = loader.score_candidates(rows)

                self.assertEqual(score_kind, "heuristic_priority")
                self.assertEqual(scores.shape, (len(FeatureBuilder.VARIANTS),))
                self.assertTrue(np.isfinite(scores).all())
                self.assertTrue(((scores >= 0) & (scores <= 1)).all())
                self.assertGreater(len(set(np.round(scores, 6))), 1)

    def test_old_placeholder_features_do_not_change_the_fallback(self):
        loader = ModelLoader.__new__(ModelLoader)
        loader._model = None
        loader._status = "missing"
        loader._artifact_info = {}
        base = self.sample_features()
        changed = dict(base, avg_session_time=3600, conversion_score=1.0)
        variants = ["vip", "boost", "credit", "profile", "bundle"]
        original = np.vstack([FeatureBuilder.build_features(base, v) for v in variants])
        modified = np.vstack([FeatureBuilder.build_features(changed, v) for v in variants])
        first, _ = loader.score_candidates(original)
        second, _ = loader.score_candidates(modified)
        np.testing.assert_array_equal(first, second)


if __name__ == "__main__":
    unittest.main(verbosity=2)
