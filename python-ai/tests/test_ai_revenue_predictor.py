import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline

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
        return model, temp_dir.name, model_path

    def test_untrained_model_does_not_invent_ltv_or_confidence(self):
        model, _, _ = self.make_untrained_predictor()
        result = model.predict_ltv([0.5] * len(predictor.FEATURE_NAMES))

        self.assertIsNone(result["predicted_ltv"])
        self.assertIsNone(result["confidence"])
        self.assertEqual(result["confidence_status"], "not_calibrated")
        self.assertIsNone(result["cv_r2"])
        self.assertIsNone(result["range"])
        self.assertIsNone(result["prediction_interval"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "model_not_trained")

    def test_invalid_feature_shape_is_rejected_as_fallback(self):
        model, _, _ = self.make_untrained_predictor()
        result = model.predict_ltv([0.5] * (len(predictor.FEATURE_NAMES) - 1))

        self.assertIsNone(result["predicted_ltv"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "invalid_features")

    def test_non_finite_features_are_rejected_as_fallback(self):
        model, _, _ = self.make_untrained_predictor()
        features = [0.5] * len(predictor.FEATURE_NAMES)
        features[0] = float("nan")
        result = model.predict_ltv(features)

        self.assertIsNone(result["predicted_ltv"])
        self.assertTrue(result["fallback"])
        self.assertEqual(result["fallback_reason"], "invalid_features")

    def test_cross_validation_scales_inside_each_fold_and_keeps_negative_r2(self):
        model, model_dir, model_path = self.make_untrained_predictor()
        X = np.arange(120, dtype=np.float32).reshape(10, 12)
        y = np.linspace(10, 100, 10, dtype=np.float32)
        expected_scores = np.array([-0.2, 0.1, 0.2, 0.3, 0.4], dtype=np.float32)

        def fake_cross_val_score(estimator, X_arg, y_arg, cv, scoring):
            self.assertIsInstance(estimator, Pipeline)
            self.assertIsInstance(cv, KFold)
            self.assertEqual(scoring, "r2")
            np.testing.assert_array_equal(X_arg, X)
            np.testing.assert_array_equal(y_arg, y)
            return expected_scores

        with patch.object(predictor, "MODEL_DIR", model_dir), patch.object(
            predictor, "GB_MODEL_PATH", model_path
        ), patch.object(predictor, "cross_val_score", side_effect=fake_cross_val_score):
            result = model.train_gb(X, y)

        self.assertEqual(result["cv_status"], "evaluated")
        self.assertEqual(result["cv_strategy"], "random_kfold_5")
        self.assertAlmostEqual(result["cv_r2"], float(np.mean(expected_scores)))
        self.assertEqual(result["cv_score"], result["cv_r2"])

    def test_small_training_set_does_not_claim_cv_quality(self):
        model, model_dir, model_path = self.make_untrained_predictor()
        X = np.arange(60, dtype=np.float32).reshape(5, 12)
        y = np.linspace(10, 50, 5, dtype=np.float32)

        with patch.object(predictor, "MODEL_DIR", model_dir), patch.object(
            predictor, "GB_MODEL_PATH", model_path
        ):
            result = model.train_gb(X, y)

        self.assertEqual(result["cv_status"], "insufficient_samples")
        self.assertEqual(result["cv_strategy"], "not_evaluated")
        self.assertIsNone(result["cv_r2"])

    def test_trained_model_does_not_expose_fixed_prediction_interval(self):
        model, model_dir, model_path = self.make_untrained_predictor()
        X = np.arange(120, dtype=np.float32).reshape(10, 12)
        y = np.linspace(10, 100, 10, dtype=np.float32)

        with patch.object(predictor, "MODEL_DIR", model_dir), patch.object(
            predictor, "GB_MODEL_PATH", model_path
        ), patch.object(
            predictor, "cross_val_score", return_value=np.array([0.1, 0.2, 0.3, 0.4, 0.5])
        ):
            model.train_gb(X, y)
            result = model.predict_ltv(X[0].tolist())

        self.assertFalse(result["fallback"])
        self.assertIsNotNone(result["predicted_ltv"])
        self.assertIsNone(result["confidence"])
        self.assertIsNotNone(result["cv_r2"])
        self.assertEqual(result["cv_strategy"], "random_kfold_5")
        self.assertIsNone(result["range"])
        self.assertIsNone(result["prediction_interval"])
        self.assertEqual(result["interval_status"], "not_calibrated")


if __name__ == "__main__":
    unittest.main()
