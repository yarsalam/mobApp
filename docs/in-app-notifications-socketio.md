# Yarsalam in-app notifications (Socket.IO only)

## Delivery architecture

- Every notification is persisted in the Yarsalam MySQL `notifications` table before realtime delivery is attempted.
- Online users receive the persisted notification through the authenticated Socket.IO namespace `/notification` and their private `user_<id>` room.
- Offline notifications remain unread in the database. When the mobile app reconnects, it invalidates its notification queries and fetches the stored inbox through the authenticated Yarsalam API.
- The inbox API always scopes reads and read/click updates to the authenticated user. A client cannot fetch or mutate another user's notifications.
- Socket delivery is best-effort, not the source of truth. The persisted notification ID makes the API inbox the reconciliation path after reconnect.

## Re-engagement policy

- An hourly backend job checks active accounts at 1, 7 and 30 days of inactivity.
- Each run creates only the highest due stage; it does not send a burst of missed stages.
- The most recently reported device timezone is read from Yarsalam's own device metadata. Unknown or invalid timezones fail closed.
- In-app reminders are scheduled only between 09:00 and 21:00 in that device's local time.
- Redis stage claims prevent duplicate notifications across hourly scans and workers.
- A rolling Redis counter caps automated reminders at three per user per 30 days.
- These reminders are stored in the in-app inbox and delivered over Socket.IO when connected. They are never sent through an external push provider.

## Platform limitation

Socket.IO and local notification presentation work only while the app can execute and maintain its connection. If the operating system fully suspends or terminates the app, the server cannot wake it or guarantee an immediate notification without a platform push service. Yarsalam does not use such a service. The notification remains stored and is fetched on the next authenticated app connection.

## Database

`docs/sql/20261114_reengagement_in_app.sql` now contains only the enum extension for the in-app `reengagement` notification type. Review and apply that migration explicitly in staging before production. No migration is applied by this branch; TypeORM `DB_SYNC` must remain false.
