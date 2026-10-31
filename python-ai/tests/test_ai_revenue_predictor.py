import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai_revenue"
sys.path.insert(0, str(SERVICE_ROOT))

import predictor  # noqa: E402


class RevenuePredictorFallbackTests(unittest.TestCase):
    def make_untrained_predictor(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        model_path = str(Path(temp_dir.name) / "gb_model.pkl")
        with patch.object(predictor, "MODEL_DIR", temp_dir.name), patch.object(
            predictor, "GB_MODEL_PATH", model_path
        ):
            model = predictor.RevenuePredictor()
        return model

    def test_untrained_model_does_not_invent_ltv(self):
        model = self.make_untrained_predictor()

        result = model.predict_ltv([0.5] * len(predictor.FEATURE_NAMES))

        self.assertIsNone(result["predicted_ltv"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIsNone(result["range"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "model_not_trained")

    def test_invalid_feature_shape_is_rejected_as_fallback(self):
        model = self.make_untrained_predictor()

        result = model.predict_ltv([0.5] * (len(predictor.FEATURE_NAMES) - 1))

        self.assertIsNone(result["predicted_ltv"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "invalid_features")

    def test_non_finite_features_are_rejected_as_fallback(self):
        model = self.make_untrained_predictor()
        features = [0.5] * len(predictor.FEATURE_NAMES)
        features[0] = float("nan")

        result = model.predict_ltv(features)

        self.assertIsNone(result["predicted_ltv"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "invalid_features")


if __name__ == "__main__":
    unittest.main()
