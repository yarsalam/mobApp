# Remote push and user re-engagement

## Separation of responsibilities

- The in-app PromotionEngine remains driven by the user's phase and in-app context.
- SEO content/campaign promotion is an acquisition channel; it does not control the in-app PromotionEngine.
- Pricing/discount experiments remain independent from both systems.
- Re-engagement is a notification lifecycle: it detects inactivity and sends a neutral return reminder. It does not silently grant discounts or fabricate likes, visitors, messages, or matches.

## Server behaviour

- The scheduler checks eligible active accounts hourly.
- Re-engagement stages are 1, 7 and 30 inactive days. A scan sends only the highest stage currently due, avoiding a burst of missed reminders.
- A user connected to the authenticated notification WebSocket is considered online and is not sent a remote push.
- Each device must have remote push enabled, a stored FCM registration token and an IANA timezone.
- Re-engagement pushes are sent only between 09:00 and 21:00 in the device's local timezone. Devices without a valid timezone are skipped.
- A rolling Redis limit caps automated re-engagement at three messages per user per 30 days. Stage claims prevent duplicate sends across hourly scans.
- The push token is stored in a column excluded from ordinary TypeORM selects and is omitted from the device-registration API response. Logout can revoke it via `DELETE /user-device/push`.
- FCM `UNREGISTERED` responses disable the stale token. Tokens and service-account private-key material are never written to logs.
- If FCM is not configured or delivery fails, the notification remains saved and unread. The existing mobile pending-notification polling remains a best-effort fallback; it is not represented as reliable remote push.

## Runtime configuration

Set `FIREBASE_SERVICE_ACCOUNT_JSON` in the backend runtime secret store to the complete Firebase service-account JSON document. It must include `project_id`, `client_email` and `private_key`. Never commit the JSON file or private key into Git.

The runtime service account needs the Firebase Cloud Messaging API permission to send messages (the `cloudmessaging.messages.create` permission). The server exchanges the service-account assertion for a short-lived OAuth access token and calls the FCM HTTP v1 API.

## Firebase owner setup still required

1. Create or select the Firebase project that will own Yarsalam's mobile apps.
2. Register the Android app with package name `com.yarsalam` and add its `google-services.json` to `mobile/android/app/`.
3. Register the iOS app using the bundle identifier from the Xcode target and add `GoogleService-Info.plist` to the iOS app target.
4. Upload an APNs authentication key in Firebase Console for iOS delivery.
5. Create a dedicated service account with FCM send permission, then store its JSON as the backend runtime secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
6. After the mobile FCM client build and backend migration have been reviewed and applied in staging, test registration, foreground delivery, background delivery, app-terminated delivery, logout/revoke and invalid-token cleanup on real Android and iOS devices.

The repository currently has no Firebase app configuration files or service-account secret. Therefore server-side delivery remains disabled until these owner-controlled inputs are supplied. The code does not generate fake registration tokens or claim a push was delivered in their absence.

## Database change

Review and apply `docs/sql/20261114_reengagement_fcm_push.sql` explicitly in staging before production. Do not enable TypeORM schema synchronization. This SQL has not been applied by this change.
