# Monetization staging acceptance contract

This document describes the staging-only integration contract for the Monetization service. It does not authorize enabling randomized promotion experiments or model training in production.

## Service and model state

- GET /health reports process health and the actual model_status, model_available, and feature_schema_version.
- GET /version reports the model artifact path, model state, schema version, and artifact metadata when present.
- The supported feature schema is version 3.
- A missing model is a valid service state: predictions use heuristic_priority, and the response must say model_status = "missing".
- Heuristic priority scores are policy scores, not calibrated purchase probabilities.
- A schema-incompatible or unversioned model artifact is rejected. The Backend fails closed if the model status and score kind do not match the contract.

## Supported promotion variants

The canonical variant keys are:

- vip
- boost
- credit (credits is accepted as an input alias and normalized to credit)
- profile
- bundle

A request must contain unique, supported candidates. Every candidate must receive exactly one finite score in the response. The top-level winner and score must match the maximum entry in all_scores.

The schema-v3 feature vector excludes the old placeholder fields avg_session_time and conversion_score. It uses actual event/registration fields, including profile_incomplete, and stores the pre-exposure snapshot with the promotion ID.

## Mobile event contract

The ID in FeedItem.id is the promotion exposure ID. The client must send these authenticated requests:

1. When the promotion card actually becomes visible (not merely when the feed is fetched): POST /feed/impression/{promotionId}
2. When the user opens/taps the promotion: POST /feed/click/{promotionId}
3. When the user dismisses the promotion: POST /feed/dismiss/{promotionId}
4. When the user purchases the promoted product from the wallet: POST /payments/buy/{bundleCode} with Idempotency-Key and JSON body containing promotionId = FeedItem.id.

The Backend verifies that the promotion ID belongs to the authenticated user and has a recorded visible impression. A purchase can only be attributed within seven days of that impression. The same exposure may produce at most one attributed conversion. A wallet purchase remains successful if attribution storage is unavailable; its response reports promotionAttribution = "failed".

The mobile app must pass the exact FeedItem.id through the promotion CTA and payment flow. Without that client-side wiring, impression/click/conversion coverage is incomplete even though the Backend endpoints exist.

## Outcome and training policy

- shown, click, and dismiss are recorded as distinct events. Click or dismiss is not a purchase label.
- A positive outcome is emitted only after a wallet purchase is explicitly associated with the same promotion ID.
- A negative purchase outcome is emitted only after the full seven-day attribution window expires without a conversion.
- Feedback is idempotent and carries the feature snapshot captured before the exposure.
- Training eligibility requires a randomized experiment ID, assignment ID, valid propensity, and an outcome label. Observational or legacy events are retained for analytics but cannot train the model.
- Randomized exploration is disabled by default. It may be enabled only in isolated staging with PROMOTION_EXPERIMENT_ENABLED=true, PROMOTION_EXPERIMENT_RATE in (0, 1], and PROMOTION_EXPERIMENT_ID set to a unique staging experiment identifier.
- Retraining requires at least 100 eligible randomized outcomes, both classes with at least 10 examples each, and at least 10 examples for every supported variant. Failed training does not consume the queue.
- The Redis feedback queue is idempotent, capped at 5,000 recent entries, and snapshot deletion removes only the exact events used by the successful training job. Events arriving during training remain queued.
- python-ai/services/ai_monetization/train_model.py is intentionally disabled; it must not generate or train on synthetic labels.

## Staging acceptance gates still required

- Run the Python Monetization contract Workflow, including the real-Redis queue tests.
- Run Backend unit tests and compile; run the wallet/MySQL idempotency integration tests.
- In Codespaces, rebuild ai_monetization, verify /health, /version, and /api/feedback/count, and send a synthetic prediction request. The expected result before training is score_kind=heuristic_priority and model_status=missing.
- Exercise the four mobile events with a single synthetic user and promotion ID, then verify the matching PROMOTION_SHOWN, PROMOTION_CLICKED, PROMOTION_DISMISSED, PROMOTION_CONVERTED or PROMOTION_NON_CONVERTED records.
- Verify that no model is produced until eligible randomized experiment outcomes exist.
- Mobile client wiring and end-to-end visible-impression / CTA / wallet-purchase verification are not considered complete until the client sends the requests above.

No production deployment, production-user data, wallet/payment data, or production experiment activation is part of this staging work.
