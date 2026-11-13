import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
import redis as sync_redis
import redis.asyncio as async_redis
from fastapi import HTTPException

# The training implementation is patched in the queue tests; keep this unit
# contract independent from downloading or executing a large XGBoost wheel.
fake_xgboost = types.ModuleType("xgboost")
fake_xgboost.XGBClassifier = object
sys.modules.setdefault("xgboost", fake_xgboost)

from core.feature_builder import FeatureBuilder
from core.model_loader import ModelLoader
from routes import promotion


class FakeEstimator:
    def __init__(self, fail=False, **kwargs):
        self.fail = fail
        self.classes_ = np.asarray([0, 1])
        self.n_features_in_ = len(FeatureBuilder.FEATURE_NAMES)

    def fit(self, features, labels):
        if self.fail:
            raise RuntimeError("synthetic fit failure")
        self.seen_rows = len(labels)
        return self


def training_row(index, variant, label):
    return {
        "user_id": 900000 + index,
        "variant": variant,
        "features": {
            "engagement_score": 0.6,
            "days_since_signup": 60,
            "dismiss_rate": 0.1,
            "last_purchase_days": 20,
            "swipe_velocity": 4,
            "promotion_ctr": 0.2,
            "hour_of_day": 12,
            "is_weekend": 0,
            "recent_event_count": 8,
            "profile_incomplete": 0,
        },
        "promotion_id": f"promotion-{index}",
        "feedback_id": f"feedback-{index}",
        "event_type": "conversion" if label == 1 else "non_conversion",
        "label": label,
        "experiment_id": "test-randomized-experiment",
        "assignment_id": f"assignment-{index}",
        "propensity": 0.2,
        "outcome_window_complete": label == 0,
        "context": {},
        "training_eligible": True,
    }


class MonetizationRedisContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Each IsolatedAsyncioTestCase owns a fresh event loop. Never reuse the
        # module-level async client across loops or its sockets become bound to
        # a closed loop from the previous test.
        self._original_redis_client = promotion.redis_client
        promotion.redis_client = async_redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/15"),
            decode_responses=True,
        )
        await promotion.redis_client.flushdb()

    async def asyncTearDown(self):
        await promotion.redis_client.flushdb()
        await promotion.redis_client.aclose()
        promotion.redis_client = self._original_redis_client

    async def test_feedback_idempotency_prevents_duplicate_queue_entries(self):
        item = promotion.FeedbackItem(
            user_id=42,
            variant="vip",
            features={
                "engagement_score": 0.8,
                "days_since_signup": 30,
                "dismiss_rate": 0.1,
                "last_purchase_days": 7,
                "swipe_velocity": 3,
                "promotion_ctr": 0.15,
                "hour_of_day": 18,
                "is_weekend": 0,
                "recent_event_count": 12,
                "profile_incomplete": 0,
            },
            promotion_id="promotion-1",
            feedback_id="same-event-id",
            event_type="dismiss",
        )

        first = await promotion.collect_feedback(item)
        duplicate = await promotion.collect_feedback(item)

        self.assertEqual(first["status"], "stored")
        self.assertEqual(duplicate["status"], "duplicate")
        self.assertEqual(await promotion.redis_client.llen(promotion.FEEDBACK_KEY), 1)
        self.assertFalse(first["training_eligible"])

    async def test_non_randomized_click_or_dismiss_cannot_train_model(self):
        await promotion.redis_client.lpush(
            promotion.FEEDBACK_KEY,
            json.dumps({
                "user_id": 42,
                "variant": "vip",
                "features": {
                    "engagement_score": 0.8,
                    "days_since_signup": 30,
                    "dismiss_rate": 0.1,
                    "last_purchase_days": 7,
                    "swipe_velocity": 3,
                    "promotion_ctr": 0.15,
                    "hour_of_day": 18,
                    "is_weekend": 0,
                    "recent_event_count": 12,
                    "profile_incomplete": 0,
                },
                "event_type": "dismiss",
                "label": 0,
                "feedback_id": "dismiss-1",
            }),
        )

        with self.assertRaises(HTTPException) as error:
            await promotion.retrain_from_feedback()

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(await promotion.redis_client.llen(promotion.FEEDBACK_KEY), 1)

    async def test_failed_fit_preserves_every_feedback_item(self):
        rows = []
        index = 0
        for variant in FeatureBuilder.VARIANTS:
            for offset in range(20):
                label = offset % 2
                rows.append(training_row(index, variant, label))
                index += 1
        for row in rows:
            await promotion.redis_client.lpush(
                promotion.FEEDBACK_KEY,
                json.dumps(row, separators=(",", ":"), sort_keys=True),
            )
        initial_count = await promotion.redis_client.llen(promotion.FEEDBACK_KEY)

        with patch.object(promotion.xgb, "XGBClassifier", return_value=FakeEstimator(fail=True)):
            with patch.object(promotion, "MODEL_PATH", os.path.join(tempfile.gettempdir(), "monetization-failed-fit.pkl")):
                with self.assertRaises(HTTPException) as error:
                    await promotion.retrain_from_feedback()

        self.assertEqual(error.exception.status_code, 500)
        self.assertEqual(await promotion.redis_client.llen(promotion.FEEDBACK_KEY), initial_count)

    async def test_successful_fit_removes_only_snapshot_and_preserves_concurrent_events(self):
        rows = []
        index = 0
        for variant in FeatureBuilder.VARIANTS:
            for offset in range(20):
                rows.append(training_row(index, variant, offset % 2))
                index += 1
        for row in rows:
            await promotion.redis_client.lpush(
                promotion.FEEDBACK_KEY,
                json.dumps(row, separators=(",", ":"), sort_keys=True),
            )
        initial_count = await promotion.redis_client.llen(promotion.FEEDBACK_KEY)
        concurrent_event = {
            "user_id": 42,
            "variant": "vip",
            "features": {"engagement_score": 0.8},
            "event_type": "click",
            "feedback_id": "arrived-during-training",
            "training_eligible": False,
        }
        concurrent_raw = json.dumps(concurrent_event, separators=(",", ":"), sort_keys=True)
        sync_client = sync_redis.Redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/15"),
            decode_responses=True,
        )
        real_dump = promotion.joblib.dump

        def dump_with_concurrent_arrival(model, path):
            sync_client.lpush(promotion.FEEDBACK_KEY, concurrent_raw)
            return real_dump(model, path)

        with tempfile.TemporaryDirectory() as directory:
            model_path = os.path.join(directory, "promotion_model_v1.pkl")
            with patch.object(promotion.xgb, "XGBClassifier", return_value=FakeEstimator()):
                with patch.object(promotion.joblib, "dump", side_effect=dump_with_concurrent_arrival):
                    with patch.object(promotion, "MODEL_PATH", model_path):
                        result = await promotion.retrain_from_feedback()

            remaining = await promotion.redis_client.lrange(promotion.FEEDBACK_KEY, 0, -1)
            self.assertEqual(result["samples"], initial_count)
            self.assertEqual(result["removed_feedback_events"], initial_count)
            self.assertEqual(result["remaining_feedback_events"], 1)
            self.assertEqual(remaining, [concurrent_raw])
            self.assertTrue(os.path.isfile(model_path))

        sync_client.close()
        ModelLoader._instance = None


if __name__ == "__main__":
    unittest.main(verbosity=2)
