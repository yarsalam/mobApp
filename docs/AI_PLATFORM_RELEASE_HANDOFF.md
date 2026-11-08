# YarSalam Release Handoff — 2026-11-08

Last updated: 2026-11-08 (GitHub source inspection)
Backend repository: `yarsalam/mobApp`
Working branch: `fix/yarsalam-ai-platform-completion-2026-11-07`
Current PR: [#17](https://github.com/yarsalam/mobApp/pull/17)
PR head inspected: `65d884f15ce191304fa22a7e19502933e27d4bad`
Base inspected: `main` at `e79910b34e7064351419252b4b4607d51e423e23`

## Product-owner decisions — preserve exactly

- Do not delete, disable, hide, or abandon any existing endpoint, page, service, or capability merely because it is incomplete.
- Keep every Revenue endpoint. Collect and report actual deposits, wallet checkout debits, successfully fulfilled purchases, product mix, payer counts, and gender splits (including women / men / unknown).
- Never fabricate missing financial values. Keep currency and minor units separate. Preserve endpoint compatibility and return explicit missing/unavailable explanations where source data is insufficient.
- Keep OCEAN. Personality inference must include user-authored text, not only database fields. Use explicit opt-in, evidence-backed estimates, uncertainty, provenance, and no psychometric/clinical claims without validation.
- Complete the six product pillars by reusing existing capabilities; do not create duplicate services when an equivalent exists:
  1. AI Self-Presentation
  2. AI Matching Intelligence
  3. AI Conversation Copilot
  4. AI Communication Safety
  5. AI Audience Intelligence
  6. AI Growth Intelligence
- Do not remove a capability without first documenting its business value, dependencies, repair cost, risk, and replacement, then obtaining explicit owner approval.
- Do not merge PRs, deploy, restart production services, or access/export production customer data without explicit authorization.
- The public website frontend repository is currently unavailable to this work. Do not assume `yarsalam/mobile` or `yarsalam/admin-panel` is that website. Both mobile and admin repositories are visible in GitHub and can be inspected independently.

## Current repository / PR state

- `yarsalam/mobApp`: public, accessible; default branch `main`.
- `yarsalam/mobile`: public, accessible; default branch `main`.
- `yarsalam/admin-panel`: public, accessible; default branch `main`.
- PR #17 is OPEN and DRAFT; it is not merged and not production-deployed. It changes 39 files (+2508/-247).
- PR #17 adds `docs/AI_PLATFORM_COMPLETION_PLAN.md`, two focused workflows, Revenue analytics, OCEAN text consent/estimate, moderation contract changes, and reuse of existing AI assistant reply functionality.
- PR #17 workflows named `Backend Revenue Quality` and `Python Moderation Contract` are present in the branch. Their exact latest run/check state still needs to be queried at the PR head before readiness can be claimed.
- Existing open issues: #13 Revenue LTV provenance/missingness; #14 Matching event schema/idempotency/attribution; #16 dependency vulnerability triage; #18 payment settlement and bundle fulfillment idempotency.

## Findings verified directly in PR #17 source

### Revenue

- New controller: `src/admin-api/controllers/revenue/admin-api-revenue.controller.ts`, route prefix `admin-api/revenue`.
- Routes present in the PR source: `ltv-by-source`, `monthly`, `historical`, `forecast`, `anomalies`, `by-gender`, `by-product`, `arppu`, `mrr`, `cohort`, `funnel`, `churn`, `concentration`, `forecast-accuracy`, `strategic-decisions`.
- `by-gender` separates wallet checkout debit events, completed commercial purchase events, and successful paid deposits; returns female/male/unknown, amounts, counts, unique users, and ARPPU.
- IMPORTANT LIMITATION: gender grouping uses the user's current profile gender at query time. There is no historic gender-at-purchase snapshot, so historical gender splits can change if the profile changes. Add immutable purchase-time snapshots in a backward-compatible way after reviewing schema/migration implications.
- IMPORTANT LIMITATION: wallet debit, completed purchase, and deposit are different financial facts. Do not add them together or label deposits as product revenue. Keep each measure separately named.
- IRT event amounts are treated as rials. USDT cents, BTC satoshis, and unverified USD units must not be combined.
- MRR/ARR and revenue churn return null/unavailable because current VIP data does not contain plan price, billing term, renewal, or source-payment linkage. Preserve these endpoints; implement the missing lifecycle ledger instead of fabricating recurring revenue.
- Production revenue data has NOT been queried in this work. No production DB, admin secret, or customer record was accessed. Endpoint implementation is not proof that the requested women/men purchase totals have been collected from production.

### Payment safety — release blocker

- PR #17's `CryptoWatcherProcessor.checkSinglePayment` now has an atomic pending→processing claim and a stale-claim recovery path.
- Wallet credit/debit paths have durable idempotency receipts and transaction-bound event logging.
- Bundle fulfillment uses per-item idempotency keys for credits/boost/VIP and a purchase event key. This supports retry after partial completion, but it is not a single all-items transaction.
- Wallet checkout debits and bundle fulfillment are separate operations. Safe retry depends on the caller reusing the same `Idempotency-Key`; verify all clients do this and persist the key across retries.
- `PaymentsController.buyWithWallet` rejects requests without `Idempotency-Key`. Check every mobile/web caller for this header before shipping; update callers without changing the endpoint contract.
- Test concurrent duplicate crypto jobs, crash after every item grant, duplicate card/manual confirmation, stale processing recovery, checkout retries with the same key, and checkout retries with a new key.
- Reconcile payment status, wallet balance, wallet ledger events, purchase events, credits, boosts, and VIP entitlements with synthetic fixtures. Production-like DB reconciliation remains pending.
- Issue #18 remains OPEN; do not mark financial release ready until its criteria pass.

### OCEAN / Personality

- PR #17 adds `GET/PATCH /personality/text-analysis-consent` and `POST /personality/ocean/text-estimate`.
- Text input includes the user's own profile/about-me/hobbies/values and up to 30 of their own non-deleted sent messages. Common email, URL, and phone patterns are redacted.
- Text estimate requires explicit consent, enforces a minimum text volume, requests five OCEAN axes with exact evidence quotes, rejects unsupported scores, caps displayed confidence at 0.5, and labels estimates uncalibrated.
- Consent withdrawal removes the latest stored text estimate.
- Text estimates are explicitly not eligible for Matching. Matching eligibility requires a validated questionnaire and separate matching consent.
- Remaining validation: prompt-injection robustness; Persian normalization and evidence matching; quoted text and copied/forwarded content; per-axis missingness; model/provider outage; consent race/revocation while analysis is in flight; retention/deletion semantics; test for no text leakage; prove UI gives consent and displays source/uncertainty.
- Existing legacy personality records may still be displayed as `legacy_unverified`; they must not influence Matching.
- No validated Persian psychometric benchmark or calibrated OCEAN model has been demonstrated. Do not market text estimates as a validated personality test.

### Communication Safety / Copilot

- PR #17 reuses existing `suggest-reply` and existing AI assistant/icebreaker functionality; generated suggestions are intended to enter the composer, not auto-send.
- Message sending rejects `pending` / `moderation_unavailable` results and requires explicit confirmation for medium warnings.
- Verify normalized Python/Nest contracts and the actual mobile/web clients end-to-end, including confirmation retry and service outage.
- Audit fallback severity/action combinations and prove fail-closed behavior at every exception/circuit-breaker path.
- Check that async moderation jobs do not later apply restrictions to a message that was never sent, and that queue retries are idempotent.

## Work still required — ordered execution plan

1. Query latest PR #17 checks and exact workflow runs; preserve current draft until review and all checks are green.
2. Audit every route in the Revenue controller against the pre-existing route inventory and every consumer in admin/mobile/web. No endpoint may disappear.
3. Fix Revenue semantics and tests: separate deposits/debits/fulfilled purchases; currency units; unknown CAC and missing LTV; zero vs null; refund/chargeback handling; cohort censoring; gender snapshot; product identity; forecast evaluation.
4. Close payment correctness: verify all caller idempotency headers, harden manual verifier and wallet checkout recovery, add crash/concurrency tests for every side-effect boundary, then reconcile all ledger/entitlement records.
5. Complete OCEAN quality/safety tests and consent UI; retain text-derived estimate as an explicitly uncalibrated separate source.
6. Complete Communication Safety and Copilot integration with the actual mobile and any available web clients.
7. Inspect existing Matching, Audience Intelligence, and Growth services and connect their current implementations rather than creating parallel systems. Address Issue #14's versioned events, idempotency, tenant binding, recommendation attribution, hard constraints, retention, and offline evaluation.
8. Inspect `yarsalam/mobile` and `yarsalam/admin-panel` against the backend contracts; run install, typecheck/lint, unit tests, and builds in CI. Public website frontend remains a separate unavailable dependency.
9. Triage Issue #16 package-by-package; no blanket forced upgrade.
10. Perform independent final review: route inventory diff, API contract tests, test/build results, security scan, data lineage, and explicit list of any remaining owner decisions. Only then report release readiness.

## Required evidence before "ready to publish"

- Exact PR head and green checks recorded.
- Every existing Revenue endpoint still present and contract-tested.
- Revenue calculations tested against synthetic fixtures for each currency and financial event type.
- Actual production Revenue report retrieved only through an authorized, read-only admin/reporting path; include period, source, unit, and female/male/unknown totals. Do not claim this has happened until an actual result is captured.
- Payment idempotency and crash-recovery tests pass; no duplicate balance or entitlement side effects.
- OCEAN opt-in, withdrawal, text evidence, missingness, and no-Matching-use tests pass.
- Moderation fail-closed and user confirmation flow pass end-to-end.
- Mobile/admin builds and available web-client contract checks pass.
- Dependency/security findings are triaged and release blockers resolved.
- Production deployment is a separate, explicitly authorized step.

## Handoff note for the next chat

Start by reading this file and `docs/AI_PLATFORM_COMPLETION_PLAN.md`, then refresh GitHub state rather than trusting this snapshot. Continue on the existing PR #17 branch unless a newer owner-approved branch supersedes it. Update this handoff file after every meaningful change and before any final report. Do not ask the owner to repeat the decisions above.


## 2026-11-08 follow-up verification

- Handoff file was created and verified at `docs/AI_PLATFORM_RELEASE_HANDOFF.md`.
- PR #17 source commit `92546b878dd8ffa76c402c37ebc9bab9b43fac15` was checked by GitHub Actions:
  - Python Moderation Contract run #58 (`42460971667`): **success**.
  - Backend Revenue Quality run #65 (`42460971727`): **success**; install, Revenue/moderation unit tests, and NestJS compile all completed.
- These are targeted backend checks, not a complete release certification; they do not cover production database data, payment crash-injection, mobile/admin builds, or live end-to-end integration.
- Additional verified mobile finding: `src/pages/payment/Basket.tsx` renders `src/components/BasketScreen.tsx`, whose online/offline payment actions still point to placeholder `https://yoursite.com` URLs. Tracked in [mobile Issue #7](https://github.com/yarsalam/mobile/issues/7). The actual route reachability and replacement using existing payment screens must be tested; do not delete the screen or payment options.
- Mobile and admin repositories are accessible, but the separate public website frontend repository remains unavailable/unidentified. Continue backend and accessible-client work without claiming the website is complete.


## 2026-11-08 additional mobile contract audit

- Confirmed a second payment integration defect in the accessible mobile repository:
  - Backend PR #17 `PaymentsController.buyWithWallet` requires an `Idempotency-Key` header and returns a bad-request error when absent.
  - Mobile `src/api/mutations/payment/useBuyWithWallet.ts` sends `POST /payments/buy/:bundleCode` without that header.
  - Tracked together with the legacy placeholder BasketScreen checkout path in [yarsalam/mobile Issue #7](https://github.com/yarsalam/mobile/issues/7).
- Remediation must create one stable key per user-initiated checkout and retain it across retries; do not generate a different key for every retry. Find and update every caller before changing the hook contract.
- This establishes a real backend/mobile contract mismatch; mobile checkout is not release-ready even though the targeted backend CI workflows passed.


## 2026-11-08 cross-repository execution log (continued)

### Backend PR #17
- Current source head: `2e24c7c2fbaa39a7e8841b6095f1154309e996bf` (Draft; not merged).
- Added an explicit `payments.productCode = 'wallet_charge'` filter to the three wallet-deposit aggregates in Revenue analytics (`by-gender`, `arppu`, `mrr`). This prevents unrelated paid products from being counted as wallet top-ups.
- Backend Revenue Quality run #70 (`42461850165`) passed: dependency install, Revenue/moderation unit tests, and backend compile.
- Python Moderation Contract run #63 (`42461850260`) passed: source compile and fail-closed tests.
- This does not constitute payment crash-injection or production-data reconciliation. Issue #18 remains open.

### Admin panel PR #38
- Repository: `yarsalam/admin-panel`; branch `fix/revenue-dashboard-contract-2026-11-08`; current head `c9161d17b4f25c91bb0b08285b87b5e1c5347f99`; Draft.
- Registered the existing `RevenueController` and `UserApiClientModule` in `ExecutiveModule`; without this, the existing `/exec/revenue/*` routes were not registered.
- Updated Revenue hook response types and normalizers for `by-product.rows`, `cohort.cohorts`, and `funnel.steps`.
- The gender table now uses `fulfilledRevenue` and displays purchase count, unique buyers, wallet debits, and wallet top-ups separately for female/male/unknown.
- The product table/chart uses fulfilled purchases rather than wallet debits.
- IRT rial amounts are converted to toman for display; unknown CAC/LTV, MRR/ARR, churn, and forecast accuracy remain visibly unavailable rather than becoming zero.
- Paid-payment trend charts are labelled as paid payments, not wallet top-ups. Wallet top-up metrics are filtered separately by `productCode=wallet_charge` in backend PR #17.
- Added a validation workflow to the existing manual runtime validation workflow. No validation run has yet been executed for this PR; keep it Draft. It depends on backend PR #17 being merged/deployed before the UI can receive the new response fields.
- No production revenue data was queried. The actual female/male totals must be retrieved through an authorized read-only reporting path after the backend is deployed.

### Mobile PR #8
- Repository: `yarsalam/mobile`; branch `fix/mobile-wallet-checkout-idempotency-2026-11-08`; current head `cce8655eb2a65aa8c160dd653aebcf36af99da49`; Draft.
- Existing `useBuyWithWallet` now sends a persisted per-user/per-bundle `Idempotency-Key`; retries after network/5xx errors reuse the key. Existing `ProductCard` passes the authenticated user ID.
- Added three focused tests: header and success cleanup; same key reused after a network failure; terminal 4xx clears the pending key.
- Android run #59 (`42461742985`) verified changed-file ESLint passed and all three new checkout tests passed. Full-repository lint found 56 errors / 196 warnings; tracked in mobile Issue #9. The existing `__tests__/App.test.tsx` failed with `SyntaxError: Unexpected token 'export'`; tracked in Issue #10. The Android APK build was skipped after the Jest baseline failure.
- Workflow was updated again to make checkout-specific lint/tests blocking, keep baseline lint/Jest audits visible but non-blocking while tracked, and continue to Android build. New run #60 is pending/queued at the time of this note; refresh it before reporting.
- Mobile Issue #7 tracks the legacy `BasketScreen` placeholder `yoursite.com` payment/cart URLs and the wallet checkout header mismatch.
- Do not merge or release until run #60's focused tests and Android APK build pass, then resolve the tracked baseline issues before full mobile release certification.

### Existing AI capability map — reuse, do not duplicate

- AI Self-Presentation: existing profile/auth-profile and personality-related services are candidates; user-facing end-to-end flow and evidence-based text improvements still need audit.
- AI Matching Intelligence: existing `python-ai/services/ml_service/routes/matching.py`, `src/suggestion` retrieval/scoring/diversity services, and matching event/attribution work in Issue #14. Do not create another matcher.
- AI Conversation Copilot: existing `src/ai-assistant` suggest-reply, icebreaker, intent, and guidance functionality. Verify composer insertion and explicit user send.
- AI Communication Safety: existing Nest moderation service/processor and Python `ai_moderation`; targeted fail-closed contract run #63 passed.
- AI Audience Intelligence: existing executive intelligence segment and female-metrics analyzers plus growth/admin reporting. Verify lineage, consent, cohort definitions, and actionable UI before claiming complete.
- AI Growth Intelligence: existing growth monetization, campaigns, SEO/social controllers, and Revenue dashboard. Complete and integrate existing paths; no duplicate growth service.
- OCEAN text inference remains in backend PR #17. Explicit consent, evidence quotes, uncertainty, and exclusion from Matching are required. Mobile UI integration and Persian benchmark/validation are still unverified.

### Public website frontend boundary
- `yarsalam/mobile` and `yarsalam/admin-panel` are accessible and being audited/fixed independently.
- The separate public website frontend repository is still unavailable/unidentified. Do not claim the public website is ready or infer that mobile/admin are its source.
- Continue backend, admin, and mobile work; record the exact public-web repository/branch as a dependency when it becomes available.


## 2026-11-08 release re-check (latest)

- Backend PR #17 remains OPEN + DRAFT at head `cee52c48363ab1d63ae8f9534cef1c6f69020200`; mergeable=true. Latest targeted workflows at this head both completed successfully:
  - Backend Revenue Quality run #66 (`42461943269`): install, Revenue/moderation unit tests, NestJS compile all passed.
  - Python Moderation Contract run #59 (`42461943287`): passed.
- Mobile PR #8 is OPEN + DRAFT at head `cc8f0d93f78deab8d430cbf0efe1b83fd7f9cc23`; mergeable=true. It now contains persistent wallet idempotency key handling, authenticated user ID, focused checkout/copilot tests, and fail-closed moderation / real-chat reply copilot integration.
- Mobile Android workflow run #65 (`42462281975`) at that exact PR head:
  - blocking changed-file ESLint: passed.
  - blocking wallet checkout + AI reply Jest tests: passed.
  - repository-wide lint/Jest audit steps completed but are configured non-blocking due existing baseline debt.
  - standalone Android APK build was still IN PROGRESS at last check; no APK artifact or build success can yet be claimed.
- Mobile repository-wide baseline issues are documented in PR #8: 56 ESLint errors / 196 warnings and an existing Jest App test ESM transform failure. Full repository audits are non-blocking; this remains quality debt to triage.
- Revenue by-gender remains based on current profile gender at query time, not immutable purchase-time gender. Historical numbers can change after profile edits. Do not claim historical gender-at-purchase accuracy until Issue #13/schema snapshot work is completed.
- Recurring revenue / MRR / ARR remain unavailable without subscription plan price, billing term, renewal and source-payment linkage. Keep endpoints and report unavailable rather than inventing values.
- Open backend release issues remain #13 (Revenue LTV provenance), #14 (Matching event integrity/attribution), #16 (npm vulnerability triage), and #18 (payment settlement/fulfillment idempotency).
- The separate public website frontend repository has not been identified or made available in the linked GitHub repositories. Mobile and admin-panel repositories are not a substitute for it.
- No production Revenue query, production payment test, production deployment, PR merge, or public launch was performed. Release is NOT certified.
