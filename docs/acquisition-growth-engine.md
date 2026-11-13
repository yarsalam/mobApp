# Yarsalam Acquisition Growth Engine

## Purpose

This is the canonical, quality-first acquisition report. It replaces channel decisions based on traffic, generic SEO scores or wallet top-ups with observable user cohorts. The first-touch channel is the primary acquisition dimension; last-touch is retained separately for journey analysis and is never counted as a second acquired user.

No score or model may turn missing data into a positive result. Unknown source is `unattributed`; missing spend means CAC is `null`, not zero.

## Touch contract

Registration accepts:

- `acquisition.firstTouch`
- `acquisition.lastTouch`
- legacy `acquisitionSource`, `acquisitionKeyword` and `metadata` fields for compatibility.

Each normalized touch may contain source, medium, campaign, campaignId, content, term, landingPage, referrer, referralCode and capturedAt.

Source labels supported by the normalizer include:

- Search: `google_organic`, `google_ads`, `bing_organic`
- AI referrals: `chatgpt_search`, `perplexity`, `copilot`, `gemini`, `claude`
- Social and messaging: `instagram`, `telegram`, `whatsapp`, `bale`, `linkedin`, `youtube`, `tiktok`, `facebook`, `x`
- Other: `referral`, `partner`, `email`, `sms`, `direct`, `unattributed`

Explicit UTM values are preferred. A referral code overrides a generic source. Recognized HTTP referrers are classified where the platform supplies a referrer. Mobile deep links can carry UTM values and referral codes with the `yarsalam://` scheme. The app freezes first touch on first launch; later tagged re-entry changes last touch only.

The authenticated `POST /auth/acquisition-touch` endpoint updates last touch and appends an idempotent `LOGIN` event tagged `kind=acquisition_touch`. The first touch is never overwritten by that endpoint.

For privacy, the normalizer stores only the landing page origin and path, and only the referrer host. It does not retain query strings, fragments, click IDs, cookies, IP addresses or user agents as attribution fields. Referral codes are retained because they are the attribution key.

## Funnel and event definitions

The cohort is users whose `User.createdAt` falls within the selected report window. That timestamp represents the account creation/registration step, not an anonymous page impression.

- Registered users: unique user records in the cohort.
- Profile completion: current `User.isCompleted` state.
- Meaningful interaction: at least one `LIKE`, `SUPERLIKE`, `MATCH` or `MESSAGE_SENT` within the first 30 days after registration.
- D7 retained: at least one `APP_OPEN`, `LOGIN`, `PROFILE_VIEW`, `LIKE`, `SUPERLIKE`, `MATCH` or `MESSAGE_SENT` in days 7–13 after registration. The denominator includes only users at least 14 days old, so the full window has matured.
- D30 retained: the same active-event set in days 30–36. The denominator includes only users at least 37 days old.
- First purchasers: unique cohort users with at least one fulfilled commercial `PURCHASE` event.

A wallet top-up (`WALLET_CHARGED`) or a payment deposit is not a product purchase and is excluded from gross product purchase revenue.

## CAC and cost ledger

Costs are recorded in `acquisition_costs` using `POST /exec/revenue/acquisition-costs` (superadmin only). Each row records source, medium, campaign or campaignId, category, amount, currency, occurrence time and an idempotency key.

Categories are media, content, labor, agency, tools and other. Labor should be entered as an explicit documented monetary amount; no hourly rate is fabricated by the system.

CAC is calculated only for an exact first-touch source + medium + campaign grouping and the selected currency/date window:

`CAC = recorded acquisition cost / new users in the matching first-touch cohort`

If no matching cost row exists, CAC is `null`. If an explicit cost row exists with amount zero, CAC may be zero. If the cohort has no new users, CAC remains `null`. Costs in different currencies are never added together.

The report currently supports IRT, USDT, BTC and USD in the cost ledger. Fulfilled product purchase events currently provide IRT amounts only; therefore gross purchase revenue per acquired user and LTV/CAC are only populated for IRT.

## Revenue interpretation and causal limits

Revenue is the gross sum of event records where:

- `type = PURCHASE`
- `metadata.isCommercialPurchase = true`
- `metadata.currency` matches the selected currency
- `metadata.amountRials` is a positive valid integer amount.

The current source ledger does not yet reconcile refunds, chargebacks or reversals. The metric is therefore observed gross fulfilled product-purchase revenue, not net revenue, profit or fully matured lifetime value.

The report is observational and descriptive. First-touch grouping, last-touch summaries or an observed difference between discount treatment and control do not prove causality. The discount experiment must not be described as increasing sales or LTV based on these descriptive values. A causal claim requires a pre-registered experiment, valid randomization and exposure receipt, an adequate sample, matured observation windows, refund reconciliation and a statistical analysis plan.

## External discovery feeds not yet connected

The normalizer can classify referral clicks from Google/Bing and AI search engines when tagged UTM values or an HTTP referrer are actually supplied. This is click/referrer attribution, not search visibility measurement.

The following are not automatically imported by this implementation:

- Google Search Console query, impression, click and AI feature reports.
- Bing Webmaster query/citation/AI performance reports.
- ChatGPT, Perplexity, Copilot, Gemini or Claude answer citation/impression logs.
- Ad-platform spend APIs.
- Play Store Install Referrer or Apple campaign/deferred-install attribution.

Those require provider credentials, consent and separately reviewed ingestion adapters. Until connected, no Search Console impression, AI citation, ad spend or store-install source is inferred.

## Schema and deployment

The entity is registered in TypeORM configuration, but production `DB_SYNC` remains disabled. The reviewed DDL is in `docs/sql/20261113_create_acquisition_costs.sql`. Apply it only through a reviewed database change process before deploying the backend; this branch does not apply schema changes or deploy to Production.

Endpoints:

- `GET /admin-api/revenue/acquisition-growth?days=90&currency=IRT`
- `POST /admin-api/revenue/acquisition-costs` (admin API key, proxied from superadmin-only admin route)
- `POST /auth/acquisition-touch` (authenticated user session)

## Acceptance checks

1. First touch remains immutable when last touch changes.
2. UTM/referral/referrer normalization maps Google, AI search, social and referral channels consistently.
3. Landing page query strings and fragments are not persisted.
4. Wallet charges are excluded from purchase revenue.
5. D7/D30 denominators include only fully matured cohorts.
6. Missing cost rows produce null CAC; explicit zero cost remains distinguishable.
7. Cost idempotency rejects reuse of the same key for a different cost entry.
8. First-touch CAC and last-touch summaries remain separate.
9. No report wording claims causal uplift or net LTV.
