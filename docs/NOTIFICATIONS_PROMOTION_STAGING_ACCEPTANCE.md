# Notifications and Promotion Staging Acceptance

Scope: Backend PR #30, Mobile Notifications PR #22, and Mobile Promotion PR #21.
This runbook is for the isolated Codespaces Staging stack only. It does not
authorize Production migration, deployment, external push providers, payment
settlement, or public exposure of the Codespaces API.

## Safety gates

Before starting the PR build in Staging, verify the effective Compose config:

- `DB_SYNC=false`. Schema changes must be applied explicitly.
- `ENABLE_REENGAGEMENT_NOTIFICATIONS=false` until the notification enum migration is verified.
- MySQL database name is exactly `yarsalam_staging`.
- MySQL and Redis have no published host ports.
- Codespaces API port 5001 remains **private**.
- Use synthetic test accounts and test-only wallet balance. Never copy Production data or credentials.

The Staging infrastructure branch has been corrected so its Compose overlay,
environment example, and bootstrap script set both feature flags to false.
After updating that branch in Codespaces, recreate the Backend container so
the effective runtime environment is refreshed. An existing initialized
Staging database is expected; do not enable TypeORM synchronization to repair
a missing schema.

## Run the Backend PR without merging it

Use the existing Codespace on branch `infra/staging-ai-lab-2026-11`.
Keep its private `.env.staging` file local and never print or upload it.

From the repository root:

```bash
git fetch origin feature/notifications-socketio-final
git worktree add --detach /tmp/yarsalam-notifications-promotion-stage origin/feature/notifications-socketio-final
cp .env.staging /tmp/yarsalam-notifications-promotion-stage/.env.staging
cp docker-compose.staging.yml /tmp/yarsalam-notifications-promotion-stage/docker-compose.staging.yml
chmod 600 /tmp/yarsalam-notifications-promotion-stage/.env.staging
cd /tmp/yarsalam-notifications-promotion-stage

COMPOSE=(docker compose --env-file .env.staging -p yarsalam-staging \
  -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.staging.yml)
```

Validate the merged config before starting anything. This check prints no
secrets and aborts if the target is not the isolated Staging database:

```bash
"${COMPOSE[@]}" config --format json | python3 -c '
import json, sys
c=json.load(sys.stdin)
b=c["services"]["backend"]["environment"]
m=c["services"]["user-mysql"]["environment"]
assert str(b.get("DB_SYNC", "")).lower() == "false", "DB_SYNC must be false"
assert str(b.get("ENABLE_REENGAGEMENT_NOTIFICATIONS", "")).lower() == "false", "re-engagement must remain disabled"
assert b.get("DB_NAME") == "yarsalam_staging", "backend DB is not staging"
assert m.get("MYSQL_DATABASE") == "yarsalam_staging", "MySQL DB is not staging"
assert not c["services"]["user-mysql"].get("ports"), "MySQL must not publish a host port"
assert not c["services"]["redis"].get("ports"), "Redis must not publish a host port"
print("STAGING CONFIG SAFE: DB_SYNC=false, reminders disabled, yarsalam_staging, data ports private")
'
"${COMPOSE[@]}" up -d --build backend
curl --fail --silent http://127.0.0.1:5001/health/ready
```

If the effective configuration check or readiness check fails, stop and report
the output. Do not turn schema synchronization back on.

## Apply the notification enum migration

Only after the config check succeeds and the Backend is running with
`DB_SYNC=false`, back up the Staging database and apply the PR migration:

```bash
BACKUP="/tmp/yarsalam-staging-before-notification-migration-$(date -u +%Y%m%dT%H%M%SZ).sql"
"${COMPOSE[@]}" exec -T user-mysql sh -lc '
  test "$MYSQL_DATABASE" = "yarsalam_staging"
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysqldump --single-transaction -u"$MYSQL_USER" "$MYSQL_DATABASE"
' > "$BACKUP"
test -s "$BACKUP" && chmod 600 "$BACKUP"

"${COMPOSE[@]}" exec -T user-mysql sh -lc '
  test "$MYSQL_DATABASE" = "yarsalam_staging"
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"
' < docs/sql/20261114_reengagement_in_app.sql

"${COMPOSE[@]}" exec -T user-mysql sh -lc '
  test "$MYSQL_DATABASE" = "yarsalam_staging"
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql -N -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "
    SELECT COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = \"notifications\"
      AND COLUMN_NAME = \"type\";
  "
'
```

The enum output must include `reengagement`. Keep
`ENABLE_REENGAGEMENT_NOTIFICATIONS=false` during the first pass; enabling
scheduled reminders is a separate controlled test using synthetic users only.

## Notifications end-to-end

Use two synthetic accounts, A and B, with valid Staging sessions.

1. Connect both clients to Socket.IO namespace `/notification` using
   `auth: { token }`. Verify valid JWT connects and invalid/expired JWT is
   disconnected. Verify A never receives an event sent to B's room.
2. Keep B online. Trigger a real notification-producing interaction from A
   through the app (for example, a like or message). Verify B receives the
   event and the corresponding record is present in B's persisted inbox.
3. Put B's app in the background while keeping its process alive. Trigger a
   second event and tap the local Notifee notification. Verify the app returns
   to the Notifications screen and records click attribution. This covers the
   warm-background resume path.
4. Disconnect B before A triggers an event. Reconnect B and verify inbox
   reconciliation retrieves the persisted notification.
5. With B's token, attempt to read or click a notification owned by A:
   `PATCH /notifications/read/:id` and `POST /notifications/click/:id`.
   Both must reject the cross-owner operation. Repeat with the owner's token
   and verify the state changes.
6. Verify unread count before/after read, duplicate realtime event handling,
   and no duplicate persisted row for one generated event.

This implementation is **in-app Socket.IO plus local Notifee presentation**.
It does not provide remote OS push when the app process is fully terminated.

## Promotion end-to-end

Use account A for the valid path and account B for ownership isolation. Ensure
A receives a promotion in `GET /feed`; the promotion ID is the exact
`FeedItem.id`.

1. Verify the feed response's promotion item and the matching
   `PROMOTION_SHOWN` event. The current flow records shown when the Backend
   assembles the feed; there is no separate mobile `/feed/impression` call.
2. Tap the card. Verify navigation continues without waiting for analytics
   and the authenticated `POST /feed/click/:promotionId` records
   `PROMOTION_CLICKED`. Dismiss a separate promotion and verify
   `POST /feed/dismiss/:promotionId` records `PROMOTION_DISMISSED`.
3. Follow the CTA into Products and confirm the same `promotionId` is retained
   through the route and the wallet request:
   `POST /payments/buy/:bundleCode`, JSON body
   `{"promotionId":"<FeedItem.id>"}`, plus a stable `Idempotency-Key`.
4. Fund only account A's Staging wallet with a test balance sufficient for the
   active bundle price; do not call any external deposit/provider. Record the
   starting balance and active bundle price. Verify exactly one debit at the
   unchanged bundle price and one purchase event whose metadata contains
   `promotion.promotionId`, `promotion.variant`, and `promotion.phase`.
5. Repeat the same checkout with the same idempotency key. Verify no second
   debit or duplicate purchase/entitlement.
6. Attempt checkout as B with A's promotion ID. Expect not-found/rejection
   before any wallet debit; B's balance and entitlements must remain unchanged.
   Also test an unknown/expired ID and a malformed ID, again with no debit.

## Mobile build warning

The automated Android test APK workflow currently defaults
`API_BASE_URL` to `https://api.yarsalam.top`. The APK artifact from the PR CI
is therefore **not a Staging client** and must not be used for these tests.
Build/run the Mobile branch with a secure private route to the Codespaces API;
do not make the forwarded Staging port public to make an APK connect.

## Completion record

Do not mark this work accepted until all of the following are recorded:

- Current Mobile PR #22 Android test APK CI is green for its current HEAD.
- Backend PR #30 CI is green for its current HEAD.
- Migration backup exists and Staging enum verification includes
  `reengagement`, with TypeORM synchronization still disabled.
- Two-account Notifications and Promotion checks above pass.
- No Production merge, migration, deployment, or external payment occurred
  during Staging acceptance.

Keep all related PRs Draft until these gates are complete.
