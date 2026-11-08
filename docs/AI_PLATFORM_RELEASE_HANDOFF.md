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


## 2026-11-08 latest continuation checkpoint

### Mobile PR #8 expanded existing integrations
- Latest inspected head: `cc8f0d93f78deab8d430cbf0efe1b83fd7f9cc23`; Draft.
- Reused the existing `AiAssistantService.suggestReply` real-chat path (`targetUserId` + latest incoming message); mobile's existing hook had only exposed the assistant `convId` path and was not connected to `ChatScreen`.
- Added a composer action that inserts a suggested reply into the draft only. User review and explicit Send remain required; the existing moderation pipeline is retained.
- Updated the existing moderation fallback: if moderation is unavailable, the client no longer offers a "send anyway" action. This aligns with the backend fail-closed contract.
- Added two API contract tests for real-chat and legacy assistant-conversation reply requests.
- Android workflow run #65 (`42462281975`) at the latest inspected head: changed-file ESLint **PASS**; focused Jest tests (wallet + chat suggestion) **PASS**; full-repository lint/Jest audits completed as non-blocking baseline audits; standalone Android test APK build was still **IN_PROGRESS**. Refresh this run before reporting final mobile readiness.
- Previous run #64 failed on one pre-existing unused `isRead` argument in `ChatScreen`; fixed by renaming it `_isRead` in the latest head. Do not treat run #64 as the current result.

### Gender attribution limitation
- Added backend [Issue #19](https://github.com/yarsalam/mobApp/issues/19): new purchase events should store a minimized normalized `genderAtPurchase` snapshot in event metadata; historical events without snapshots must expose their current-profile fallback coverage. This prevents future profile edits from rewriting historical female/male purchase reports.
- Until Issue #19 is implemented, the Revenue dashboard explicitly labels the current-profile attribution basis. Do not describe the historical gender totals as immutable.

### Current draft PR heads
- Backend PR #17: `cee52c48363ab1d63ae8f9534cef1c6f69020200` (Draft; targeted Revenue and moderation checks passed on source commit before the docs-only handoff update).
- Admin PR #38: `e5e6708715f10a37b6c1972d461b6e7475f2d346` (Draft; validation workflow added but not yet run).
- Mobile PR #8: `cc8f0d93f78deab8d430cbf0efe1b83fd7f9cc23` (Draft; focused checks passed, Android APK build pending).
- Do not merge any PR or deploy without owner authorization and the listed acceptance evidence.


## 2026-11-08 final handoff update before next validation refresh

- Mobile PR #8 now includes the existing chat Copilot integration and fail-closed client moderation change in addition to wallet idempotency. Latest branch head: `cc8f0d93f78deab8d430cbf0efe1b83fd7f9cc23`.
- Current Android workflow run #65 (`42462281975`) has completed changed-file ESLint and focused Jest steps successfully. Android standalone test APK build is still running; do not claim the mobile PR is fully green until the run and artifact preparation/upload complete.
- Mobile [Issue #11](https://github.com/yarsalam/mobile/issues/11) tracks the missing user-facing OCEAN text-analysis consent/estimate UI. The mobile `main` tree contains no OCEAN/personality client path. The integration must reuse backend PR #17 endpoints and existing profile/personality UI, require opt-in, expose evidence/uncertainty, allow withdrawal, and never feed unvalidated text estimates into Matching.
- The separate public website frontend is still not present in the accessible `yarsalam` repository list. The six capability pillars must not be declared complete based solely on backend or mobile work.
- Admin PR #38 latest head remains `e5e6708715f10a37b6c1972d461b6e7475f2d346`; manual server/web validation has not been run. Do not call the admin revenue dashboard release-ready yet.
- Actual production female/male revenue totals have not been retrieved. The endpoint and UI are being aligned, but a read-only production reporting authorization is still required to collect real values.


## 2026-11-08 moderation acknowledgement and latest PR checkpoint

### Backend moderation contract
- Backend PR #17 now returns explicit `requiresConfirmation` and `blocked` flags from the moderation check endpoint, in addition to `allowed` and `severity`.
- Message edits now use a validated `UpdateMessageDto`, fail closed for pending/unavailable moderation, and require explicit `acceptModerationWarning=true` for medium-risk edits. High/block outcomes remain blocked even if a client sends the acknowledgement.
- Latest backend source head: `43a5f58ad0d3668504c48d7d115e23c0d03658a7`. Backend Revenue Quality run #77 and Python Moderation Contract run #77: PASS (tests/compile and Python fail-closed contract respectively).

### Mobile PR #8 latest state
- Latest head: `da192e660a6139ee65fb1e393d19bf835a870d40`; Draft.
- Client now distinguishes allow / explicit medium-risk confirmation / block / moderation unavailable using backend `requiresConfirmation` and `blocked` fields.
- The same explicit acknowledgement is forwarded for both message creation and message editing. High-risk or unavailable moderation cannot be overridden in the client.
- Added focused tests for wallet retry idempotency, real-chat reply suggestions, moderation decision outcomes, and send/edit acknowledgement serialization.
- Latest run #75 (`42462885646`) was **IN_PROGRESS** at this checkpoint. Earlier runs on intermediate commits are also still in progress and are not substitutes for the latest-head result. Refresh the latest run and verify the APK build and artifact upload before reporting.
- Mobile baseline debt remains tracked separately in Issues #9 and #10; do not silently suppress or delete tests/features.

### Admin PR #38 latest state
- Latest head: `f7ccfbac0282d0964a25060a37a776b3e16170d5`; Draft.
- Revenue trends are labelled as paid payments (not wallet deposits); wallet top-ups are separately filtered in backend PR #17.
- Admin validation workflow has not been run. Manual workflow dispatch against this branch is still required before this PR can be considered validated.

### Remaining release gates already recorded in Git
- Issue #13: LTV feature provenance/missingness and no synthetic defaults; commercial LTV/CAC/ROI claims remain NO-GO.
- Issue #14: Matching event schema, idempotency, hard constraints, and recommendation attribution remain incomplete.
- Issue #16: dependency vulnerability scan was previously 54 findings; current lockfile scan and triage remain outstanding.
- Issue #18: payment crash-injection, concurrency, stale-lease recovery, and ledger reconciliation remain incomplete.
- Issue #19: immutable purchase-time gender attribution snapshot remains outstanding.
- Mobile Issue #7: legacy Basket route still contains placeholder URLs; route is registered but no direct current navigation call was found. Preserve it until reachability, price units, and intended direct-vs-wallet payment semantics are confirmed.
- Mobile Issue #11: OCEAN text-analysis consent and estimate UI is absent from the current mobile tree; reuse backend endpoints and existing profile UI after PR #17 is available.
- Public website frontend repository and authorized read-only production revenue access remain unavailable.


## 2026-11-08 OCEAN mobile integration checkpoint

### Backend PR #17
- Added `GET /personality/ocean/text-estimate`, which returns the stored estimate only while explicit text-analysis consent is enabled. Revoked consent returns `assessment: null`; the existing revoke path removes the stored estimate.
- PersonalityService unit tests now cover consent-gated estimate retrieval.
- Latest source head: `10a0f071b8063dc459d235454c9bbff7a1d3db70`.
- Backend Revenue Quality run #80 and Python Moderation Contract run #73: PASS.

### Mobile PR #12 — OCEAN consent UI
- Branch: `feat/mobile-ocean-consent-ui-2026-11-08`; latest head `0b4472ae31e8207a2c531cbf01994c761a7189b3`; Draft.
- Reuses the existing AI Advice screen and backend consent/estimate endpoints; no second personality model or questionnaire was created.
- The user must explicitly opt in before analysis. The UI explains profile/about text, hobbies, values, up to 30 self-authored sent messages, and backend redaction of contact details/links.
- Shows all five axes, raw scores, uncalibrated confidence, exact evidence quotes, insufficient-data states and limitations. It states estimates are not validated psychometrics and are excluded from Matching.
- Revoking consent deletes the stored text estimate while preserving the existing questionnaire and unrelated profile metadata.
- Android workflow run #80 (`42463238514`) was **IN_PROGRESS** at this checkpoint; focused lint/API tests and Android APK build must be refreshed before calling the PR validated.
- Tracked in [mobile Issue #11](https://github.com/yarsalam/mobile/issues/11).

### Mobile PR #8 — payment, Copilot and moderation
- Latest head: `3efd824a0e0d4e1e566a66edc024d4e7058f311a`; Draft.
- Android run #75 (`42463163921`): changed-file ESLint **PASS**; focused Jest wallet/chat/moderation tests **PASS**; Android standalone test APK build **IN_PROGRESS**. Refresh artifact/checksum upload before reporting.
- An earlier focused test run failed only because a Jest test used dynamic import without VM modules; changed to static import and the latest focused test suite passed.
- Full-repository lint/Jest baseline debt remains in Issues #9 and #10; focused changed-file gates are blocking.



## 2026-11-08 owner-directed release push — mobile is current public client

Owner decision: the public website is deferred and is not a release blocker. Current release scope is mobile app + backend + private admin panel. Do not interpret this as replacing the future public website. This scope was recorded in [Issue #20](https://github.com/yarsalam/mobApp/issues/20).

### Exact current PR heads (refreshed)
- Backend PR #17: `10a0f071b8063dc459d235454c9bbff7a1d3db70` (Draft).
  - Backend Revenue Quality run #80 (`42463008615`): PASS — locked dependency install, Revenue/moderation unit tests, Nest compile.
  - Python Moderation Contract run #73 (`42463008707`): PASS — compile and fail-closed contract.
- Mobile PR #8: `3efd824a0e0d4e1e566a66edc024d4e7058f311a` (Draft).
  - Android run #77 (`42463163921`) is still IN_PROGRESS at this handoff: changed-file lint and focused wallet tests passed; repo-wide lint/Jest audit steps completed as non-blocking; Android APK build is still running and no artifact is available yet. Do not report this head as APK-ready until build, per-ABI packaging, checksums, and artifact upload complete.
  - Existing issue #7 remains a real legacy Basket route finding: route is registered, and `BasketScreen.tsx` still points to `https://yoursite.com/payment` and `https://yoursite.com/cart`. It is not currently navigated from the Products flow found in repository inspection, but it is reachable by the registered Basket route. Direct-vs-wallet semantics and price unit are undocumented; do not silently repoint or delete it. Owner decision is required for that legacy behavior.
  - OCEAN consent/estimate UI is still absent (Issue #11). Backend endpoints exist in PR #17, but mobile integration, explicit opt-in, evidence/uncertainty display, withdrawal, and tests are not implemented yet.
- Admin PR #38: latest source head `d59bb82f3d6ba1a3ecbce4141cba963bc56dc40e` (Draft).
  - Revenue controller registration and response/UI corrections are present in source.
  - First exact-head validation failed during install because the hosted runner received HTTP 429 from the custom Iran npm mirror `npm.devneeds.ir`; a follow-up attempted an unsupported pnpm flag and failed immediately.
  - Remediation committed: rewrite 1,079 lockfile tarball URLs from the throttled custom mirror to canonical `https://registry.npmjs.org/`, and simplify the install command to `pnpm install --frozen-lockfile --registry=https://registry.npmjs.org`. Commit: `d59bb82f3d6ba1a3ecbce4141cba963bc56dc40e`. A new successful validation for this exact head has not yet been observed; do not claim Admin is green.
  - Separate Admin PR #37 has a successful Revenue Admin Validation run #34 (`42460759669`) on its own head `23ec314894c3212a51fc26aca9d6dc715f085745`; this does not certify PR #38's extra controller registration or exact-head build.

### Newly verified release blockers
- Backend Issue #18 remains open: no crash-injection/concurrency proof or synthetic ledger/entitlement reconciliation. PR #17 changes do not establish exactly-once side effects under all crash boundaries.
- Backend Issue #16 remains open: previous npm audit reported 54 vulnerabilities (8 low, 24 moderate, 17 high, 5 critical). Exact current lockfile audit, exploitability/reachability classification, remediation and SBOM are not complete.
- Backend Issue #19 remains open: purchase-time immutable gender snapshot is not implemented; historic female/male attribution uses current profile gender.
- No production Revenue report was queried. Do not invent female/male purchase totals or access customer/financial data without explicit read-only authorization.
- Production deployment package is not certified: verify production runtime Compose/image path, DB migrations/bootstrap, health checks, backup/restore, rollback, secret/env configuration and private admin exposure before deployment.
- No PR was merged, no Production deploy/restart occurred, and no production customer data was read/exported.

### Immediate next actions
1. Verify Admin PR #38 CI after the canonical-registry lockfile fix; if it still fails, use the exact logs to repair and rerun.
2. Finish Mobile run #77 and record final APK artifact ID, SHA-256 and exact source head.
3. Integrate mobile OCEAN consent/estimate UI using existing backend endpoints and existing profile/personality UI; do not create a parallel personality model.
4. Resolve legacy Basket behavior only after the owner confirms the price unit and intended direct-payment vs wallet-funding semantics; preserve both existing payment choices until then.
5. Add reproducible payment crash-injection and reconciliation tests; complete current dependency audit/SBOM; address high/critical runtime-reachable findings safely.
6. Validate backend/mobile/admin contracts and create production deployment bundle/runbook including health, backup/restore and rollback. Production action remains separately authorized.

This handoff reflects GitHub evidence only. A green targeted workflow or test APK is not equivalent to a signed production release or a successful live deployment.


## 2026-11-08 immediate release execution — current evidence

The owner confirmed that the public website is deferred. Current release scope is mobile app + backend + private admin panel. This is recorded in Issue #20; no production deploy/restart, merge, or customer-data access has been performed.

### Admin consolidated candidate
- Use PR #37 branch `fix/yarsalam-ai-platform-completion-2026-11-07` as the consolidated admin candidate, rather than PR #38's narrower duplicate branch.
- Exact PR #37 head: `a92239c9f1ecded25a87cc6c52c2b06ff41e88ac`.
- Added `RevenueController` and `UserApiClientModule` to `ExecutiveModule`; added the module path to the Revenue validation workflow.
- Runtime image build and standalone `/login` smoke run `42463414826`: SUCCESS.
- Revenue lint, web type-check gate, and Nest server build run `42463415048`: SUCCESS.
- Image was not pushed and no VPS changes occurred.
- PR #38 run `42463313921` failed full web type-check. Its exact errors include Revenue tooltip callback types, nullable chart data, PieLabelRenderProps custom fields, and additional admin modules. Do not promote PR #38 as the candidate.

### Backend runtime and dependency evidence
- Backend PR #17 head at the latest source refresh: `bf0d779260ef1bcce30814343cef292971c508d8` (Draft).
- Revenue Quality run `42463927604`: SUCCESS.
- Python Moderation Contract run `42463927333`: SUCCESS.
- Compose configuration validation run `42463927359`: SUCCESS, including backend-only runtime Compose.
- Added to PR #17 branch: hardened Node 22 runtime Dockerfile; immutable backend-only runtime Compose; Trivy image workflow; `docs/PRODUCTION_RELEASE_RUNBOOK.md`; full dependency audit + CycloneDX SBOM workflow; semver-compatible remediation preview workflow.
- Backend runtime image run `42464078958` was IN_PROGRESS at the last refresh; no successful scan or GHCR publish is claimed.
- Initial npm audit on unremediated tree: full dependency tree 54 (5 critical, 17 high, 24 moderate, 8 low); production only 24 (2 critical, 15 high, 7 moderate). Artifact `13610657861`, SHA-256 `bc955c58f1bbba2e60612fce55a02af2da2c68f8280bc00cb4af86d645a1144d`.
- Non-forced semver-compatible remediation candidate: backend build passed and full unit suite passed after correcting Jest async mock typing. Production audit still reports 1 critical, 7 high, 4 moderate. Candidate lockfile + audit + CycloneDX SBOM artifact `13611365109`, SHA-256 `e2e7caa8741ea3df7d310fb06227887f343199c578602f2e59c293e541c9423e`.
- Candidate lockfile was generated in CI and not yet accepted/committed as the final lockfile. Workflow now has a guarded commit step after successful build/tests; refresh branch and exact head before relying on it.
- Do not use `npm audit fix --force`. Remaining findings need targeted direct/transitive remediation and tests.

### Mobile
- PR #8 branch `fix/mobile-wallet-checkout-idempotency-2026-11-08`; latest head must be refreshed after the last docs/lint-only commits.
- Added `useTextPersonality.ts` and `TextPersonalityAnalysisCard.tsx`, wired into the existing AI Advice screen. Consent is off by default; the user must opt in; UI describes profile + up to 30 own sent messages, shows evidence/uncertainty, supports revocation, and states the unvalidated text estimate is not used by Matching.
- Android test workflow now uses `assembleDebug` and explicit test-only filenames; production release no longer signs with the debug key. `android-signed-release.yml` requires private owner-controlled keystore secrets and verifies signatures and SHA-256 checksums.
- Android run `42463796874` passed dependency install, changed-file lint, focused wallet tests and baseline audit steps; Android APK build was still IN_PROGRESS and artifact list empty at last refresh. This run predates the final OCEAN lint-list/docs-only commit; refresh latest PR head and CI.
- Production signing secrets are not configured in this repository. See `docs/ANDROID_SIGNED_RELEASE.md`. Never generate a replacement key if an earlier production APK was distributed without checking upgrade compatibility.

### Deployment runbook and hard blockers
- `docs/PRODUCTION_RELEASE_RUNBOOK.md` covers read-only host preflight, MySQL/public-assets backup and restore proof, runtime-only backend replacement, health checks, private admin deployment, signed mobile, and rollback.
- Current `GET /health` is liveness only, not DB/Redis/payment readiness.
- No live VPS inspection, backup/restore test, GHCR publish, signed APK build, production database report, or production deployment has occurred.
- Backend Issue #18 payment crash-injection and ledger/entitlement reconciliation remain open.
- Backend Issue #19 purchase-time gender snapshot remains open; historical gender uses current profile attribution.
- Mobile Issue #7 legacy Basket placeholders remain. Route is registered but not found in the current Products navigation. Before altering, owner must confirm whether `price` is rials or tomans and whether the intended action is direct payment or wallet funding.
- Mobile Issue #11 now has a first UI implementation in the PR branch; it still requires exact-head lint/build and functional consent/revoke verification.

No release-ready claim is justified until remaining critical/high production dependencies, payment crash proof, mobile APK and signing, and backup/rollback gates are resolved.


## 2026-11-08 follow-up — dependency remediation and readiness

### Backend dependency remediation
- Tested and committed to PR #17 branch: `bcrypt@6.0.0`, `sharp@0.35.5`, `multer@2.5.0`, `ip-address@10.7.4`, and targeted `brace-expansion@1` override to `1.1.21`.
- Candidate validation: npm ci PASS; backend build PASS; full unit suite PASS; production npm audit PASS at **0 critical / 0 high / 3 moderate**; CycloneDX SBOM generated.
- Remaining three moderate findings are TypeORM 0.3.31 and its glob/minimatch dependency chain. npm audit suggests TypeORM 1.1.2, a semver-major migration; do not upgrade blindly. Review TypeORM 1.1 API/driver/Nest integration and run migrations/transaction tests before considering it.
- Candidate artifact `13610881807`, SHA-256 `50330f43475495b07307d2b02674ced451e15158687fff362a9cbd71399462c4`.
- A previous runtime image build failed because bcrypt 5 tried to download a GitHub-hosted prebuilt binary (504) and the image build stage lacked `make` for source compilation. That run predates bcrypt 6. New exact-head runtime image/Trivy validation is running after the tested dependency update.
- Backend current PR head at the latest refresh: `07becf3b8885edb7fa06b40fc3496871bce728b2`; later runbook/health workflow commits may advance it; refresh before merging.

### Backend readiness probe
- Added `GET /health/ready` to complement existing liveness `GET /health`.
- Readiness runs MySQL `SELECT 1` and Redis `PING`; returns 200 only if both succeed, otherwise 503 with sanitized status and no raw dependency errors.
- Added `src/app.controller.spec.ts` tests for liveness independence, healthy DB+Redis, and sanitized 503.
- `RedisService.ping()` exposes only the readiness operation; no credentials or internal error strings are returned.
- Backend Revenue Quality workflow path filters now include the health controller/spec and Redis service, and run the new readiness test.

### Mobile Jest baseline
- Full Jest run on PR #8 head `247bb6...` failed only in `__tests__/App.test.tsx` due `react-native-device-info` creating a NativeEventEmitter with no native module in Jest.
- Added `jest.setup.js` mock for the device-info module and configured it in `jest.config.js`; Android workflow now triggers on Jest config/setup changes and full Jest is blocking.
- Latest mobile exact-head workflow must be refreshed; do not claim full Jest or APK build passed until the new run completes.


## 2026-11-08 exact-head confirmation

- Current backend PR #17 head: `bc9d8a6f945d20f29594c21e20fcb04710a3993b`.
- Current exact-head Backend Revenue Quality run `42464680472`: PASS, including Revenue/Personality unit tests, the new health readiness spec, and Nest compile.
- Current exact-head Python Moderation Contract run `42464680471`: PASS.
- Current exact-head Compose validation run `42464680515`: PASS.
- Current exact-head dependency audit run `42464680556`: PASS, production audit **0 critical / 0 high / 3 moderate**. Remaining moderate findings are TypeORM 0.3.31 plus its glob/minimatch chain; upgrade suggestion TypeORM 1.1.2 is semver-major and not applied.
- Current audit/SBOM artifact ID `13610724743`, SHA-256 `a9d4ef1d3f79dda0848de555528aaa4f80af4adfdfadedb98d23fcce001320a1`.
- The tested candidate uses bcrypt 6.0.0, sharp 0.35.5, multer 2.5.0, ip-address 10.7.4 and brace-expansion@1 1.1.21. CI install/build/full backend tests and zero-critical/high audit gate passed before the candidate package files were committed.
- Current exact-head Backend runtime image build/Trivy run `42464680552`: IN_PROGRESS at this refresh. No GHCR publish or image digest is available yet.
- New `GET /health/ready` readiness probe and `src/app.controller.spec.ts` tests are included in the passing Backend Revenue Quality run. It checks MySQL SELECT 1 and Redis PING; current route is readiness for those two dependencies only, not payment/queue/Qdrant readiness.
- Current mobile PR #8 head: `c06c491dc1505dd1d88b474f36f74e2a50d0f7ba`. Android test workflow `42464723027` is IN_PROGRESS. Previous run `42464399149` passed targeted lint and wallet tests but full Jest failed only because `react-native-device-info` required a native event emitter in Jest; a test mock and Jest setup have been added, and the new exact-head run is pending. APK build and artifact are not yet confirmed.
- Admin PR #37 exact head `a92239c9f1ecded25a87cc6c52c2b06ff41e88ac`: Revenue validation run `42463415048` PASS; admin runtime image build + `/login` smoke run `42463414826` PASS. No admin image publish.


### Latest audit refresh
- Current Backend PR #17 head `b5b0f2917d9261a6247ab245602e197732f5e23b` audit run `42464774699`: PASS, 0 critical / 0 high / 3 moderate.
- Artifact `13611067777`, SHA-256 `b6999d796ad3db44b1dba26b94ff52cdd2cce4a411cab5cb320a65aa6b622213`.
- Current exact-head runtime image build `42464774684` and full dependency remediation/build/test run `42464774685` are still IN_PROGRESS.
- Mobile current PR #8 head `240d7bd80ee3a6d8e2df3cc31fc5a884be8ef53f`; Android test workflow run `42464723027` is still IN_PROGRESS at SDK/JS dependency setup. The only change after run #101's checkout was the signed-release artifact action version; no APK artifact exists yet.


### Runtime image scan follow-up
- Runtime image build succeeded on the updated backend dependencies, but Trivy found 10 HIGH / 0 CRITICAL in the Node base image's global npm CLI packages (not OS packages and not the app's audited production dependency tree): npm-bundled `brace-expansion`, `ip-address`, `pacote`, `picomatch`, and `sigstore`.
- The runtime container only executes `node dist/main.js`; it does not need npm/npx. The final Docker stage now removes `/usr/local/lib/node_modules/npm`, `/usr/local/bin/npm`, and `/usr/local/bin/npx`. Builder stage keeps npm for build/install.
- New exact-head build + Trivy run `42464972290` is IN_PROGRESS; do not publish until it passes. If scan still finds application packages, inspect the exact package path and patch the relevant runtime dependency rather than suppressing the finding.


### Latest mobile native-test and runtime-image follow-up
- The first full Jest rerun after adding the DeviceInfo mock exposed another missing native module, `react-native-background-fetch`. A test-only mock is now added to `jest.setup.js`; current Android workflow run `42465041567` includes the updated setup and is pending at Node setup.
- Current mobile run `42465041567` has not yet reached full Jest or APK build; no current APK artifact exists.
- Backend runtime image build after removing global npm/npx from the final image: run `42464972290` is still in the image-build step; Trivy has not yet run. No image publish.


## 2026-11-08 final snapshot at 08:58Z

- Backend PR #17 latest branch head: `0409893b79fb13f35303ec38142a8a42955e6e31`. It includes the tested backend source, the runtime Dockerfile removal of unused npm/npx, and a workflow step to export a scanned PR image as a 14-day artifact. The prior exact source SHA `d578868011bc899d07e5be63777875f0c9facb7e` completed runtime image build + Trivy CRITICAL/HIGH scan successfully. New export-enabled run `42465122119` is building; no image artifact is available yet.
- Mobile PR #8 latest head: `19c5c299dd907d3362a70d72550e72601b07b04d`. Android run `42465041567` passed Android SDK setup, JS install, API URL validation, blocking changed-file lint (including OCEAN), repository lint audit (non-blocking), and focused wallet Jest tests. Full Jest is now running after adding DeviceInfo, Notifee and BackgroundFetch test mocks. APK build/artifact steps have not started.
- Admin PR #37 latest head remains `a92239c9f1ecded25a87cc6c52c2b06ff41e88ac`; Revenue validation and admin runtime image + `/login` smoke runs remain green.
- All three PRs remain Draft. No GHCR publish, APK distribution, merge, server change, or production deployment occurred.
