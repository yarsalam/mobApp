# Yarsalam production release runbook — mobile + backend + private admin

Status: **preparation only — not an authorization to deploy**.
Release scope: mobile app is the current public user-facing client; backend API; private admin panel. The public website is deferred.

## 1. Release invariants

- Preserve all existing backend endpoints, payment methods, admin pages, and mobile features.
- Backend must be deployed before the admin Revenue dashboard that consumes the new Revenue response fields.
- Keep the admin panel private. Do not expose its URL or login flow in the public mobile/download flow.
- Use immutable full-commit image tags. Never deploy a moving `latest` tag.
- Do not run the development Compose stack on the production host.
- Never use `DB_SYNC=true` in production. The current repository has no reviewed TypeORM migration/bootstrap path; the existing production database must be preserved. A fresh DB deployment is blocked until migrations are created and reviewed.
- Never use the Android debug keystore for production. Signed production APKs require the owner-controlled release keystore.
- Do not perform deployment, container replacement, service restart, database access, or customer-data export without the owner's separate explicit authorization.

## 2. Exact artifact and commit ledger

Before any deployment, record:
- Backend source commit and immutable GHCR image tag/digest.
- Admin source commit and immutable GHCR image tag/digest.
- Mobile source commit, APK filenames, SHA-256 checksums, signing certificate fingerprint, and API origin.
- Workflow run URLs, conclusions, artifact IDs, and SBOM/audit artifact IDs.
- Previous running backend/admin image tags and Compose project identity for rollback.

An image build without a successful security scan is not publishable. A debug-signed test APK is not a production mobile release.

## 3. Read-only host preflight

Run these read-only checks first, and capture the output securely (do not paste secrets into GitHub issues):

```bash
docker inspect backend --format 'project={{index .Config.Labels "com.docker.compose.project"}} service={{index .Config.Labels "com.docker.compose.service"}} image={{.Config.Image}}'
docker inspect backend --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
docker network inspect yarsalam_network --format '{{.Name}}'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

Verify the existing Compose project label, MySQL and Redis container names, network membership, public-assets host path, reverse-proxy mapping, and current image tags. Never guess `PUBLIC_ASSETS_DIR` or the project name.

## 4. Backup gate

Before touching containers:
1. Confirm a recent MySQL backup exists and is restorable. If creating one, use the actual existing DB container/user/database and a private destination; include routines, triggers, events, and binary data. Do not put credentials on a command line or in shell history.
2. Snapshot the existing public upload/assets directory, preserve ownership and permissions, and record a checksum manifest.
3. Verify Redis persistence/backup policy and inspect pending BullMQ jobs. Do not flush Redis or discard queues. If Redis is not backed up and its data contains durable job state, stop and design a safe snapshot/drain plan first.
4. Record backup timestamp, file sizes, SHA-256 checksums, and a restore-test result in a private operations record.
5. Test restoration to an isolated environment before the production cutover.

**No backup is considered valid until restore has been tested.** The deployment must stop if the database or public-assets backup cannot be verified.

## 5. Backend image and limited replacement

Preconditions:
- Exact backend commit has passed unit/compile workflows.
- Dependency audit has no unresolved critical/high production findings, or an explicit reviewed mitigation is approved.
- Runtime image builds and Trivy CRITICAL/HIGH scan pass on the exact commit.
- The image is published to GHCR under an immutable `sha-<full-commit>` tag.
- Runtime Compose configuration is validated and its required environment variables are set in the private host env file.

The current runtime-only Compose design uses the existing external `yarsalam_network`, existing MySQL/Redis services, loopback-only API binding at `127.0.0.1:5001`, and the existing public-assets mount. It must not recreate MySQL, Redis, Qdrant, or AI services.

Only after owner authorization, the preflight and backup gates, and image publication:

```bash
docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml pull backend
docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml up -d --no-deps --force-recreate backend
```

Do not run project-wide `down`, prune volumes, or rebuild source on the VPS.

## 6. Health and smoke checks

The Nest health routes are:
- `GET /health`: process liveness only; returns `{ status: "ok", timestamp }`.
- `GET /health/ready`: readiness; runs `SELECT 1` against MySQL and `PING` against Redis, returns 200 only when both respond, otherwise 503 with sanitized per-dependency status. It does not prove payment-provider reachability, queue processing, Qdrant, or AI-service readiness.

After an authorized cutover:
- `curl -fsS http://127.0.0.1:5001/health`
- `curl -fsS http://127.0.0.1:5001/health/ready` (must return 200 before traffic is shifted)
- Check container restart count and logs.
- Verify authenticated read-only API access and admin-to-backend proxy connectivity.
- Verify MySQL and Redis connectivity from the backend without exposing credentials.
- Run synthetic-only Revenue contract checks; do not query production customer/financial data unless separately authorized.
- Run payment sandbox/synthetic checks only. Never perform a real charge as a smoke test.
- Verify a known public asset URL and file persistence.
- Verify the admin remains reachable only through the private admin hostname/reverse proxy and is not exposed as a public API or mobile download route.

A green `/health` response alone is insufficient for release acceptance.

## 7. Private admin image

- Build the standalone admin image from the reviewed admin commit with exact `NEXT_PUBLIC_API_URL=https://api.yarsalam.top`.
- Require successful server build, web type-check, Revenue-specific lint/type validation, and standalone `/login` HTTP smoke.
- Publish only an immutable SHA tag after the exact source is approved.
- Bind the admin container to host loopback and preserve the existing private reverse-proxy/host policy. The admin domain must remain separate from the public mobile download flow.
- Do not publish or deploy the admin image until backend Revenue endpoints and contracts are available.

## 8. Signed mobile release

- Build test APKs with the debug variant only; label them test-only.
- Production release uses `assembleRelease` and a private owner-controlled keystore supplied through GitHub Actions secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- The Android Gradle release signing configuration must fail closed if any signing secret is missing. It must never fall back to `debug.keystore`.
- Validate the embedded API origin is the production HTTPS API hostname.
- Verify APK signatures with `apksigner verify`; record certificate SHA-256 fingerprint, source commit, per-ABI APK hashes, and artifact ID.
- Do not publish a public release or distribute APKs until the owner approves the signed artifact and version.

## 9. Rollback

Before cutover, record the previous immutable backend and admin image tags and keep the previous images available.

If backend smoke checks fail, and only after owner authorization:

```bash
# Restore the previous full-SHA image tag in the private .env.production.
# Keep the exact existing Compose project, network, env file and mounts.
docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml pull backend
docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml up -d --no-deps --force-recreate backend
curl -fsS http://127.0.0.1:5001/health
```

For admin rollback, restore the previous immutable admin image tag and replace only the admin service. Do not roll back or recreate MySQL, Redis, Qdrant, volumes, or the full Compose project.

If a schema change has been introduced, an application-image rollback is safe only if the schema remains backward compatible. The current release must not introduce unreviewed destructive migrations.

## 10. Current hard blockers

- Backend dependency audit: the latest captured production audit reported 2 critical, 15 high, and 7 moderate findings. Non-forced remediation preview and test workflow is in progress; no forced upgrades are approved.
- Payment correctness: crash injection at every side-effect boundary, duplicate/concurrent settlement, stale-claim recovery, and ledger/entitlement reconciliation remain unproven (Issue #18).
- Revenue gender attribution: historical values still rely on current profile gender until immutable purchase-time snapshots are added (Issue #19).
- Mobile production signing: owner-controlled keystore secrets are not present in the repository; the signed release workflow cannot run until they are configured privately.
- Mobile OCEAN UI has been added to the current PR branch but still needs exact-head CI and functional verification.
- Legacy Basket route still points at placeholder URLs. Its intended direct-payment vs wallet-funding behavior and price unit are not established; preserve it and obtain the owner decision before changing that flow.
- Runtime backend image/Trivy workflow and runtime-only Compose PRs are separate stacked branches and need reconciliation with the current backend PR before release.
- Production database schema/migration readiness, actual production Revenue read-only reporting, and backup/restore proof are not complete.

No production commands in this document have been executed.
