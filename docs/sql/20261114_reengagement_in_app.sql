-- In-app re-engagement notification type only.
-- No push-token columns, provider state tables, or external-service credentials.
-- Review and apply explicitly in staging; keep DB_SYNC=false.

ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM(
    'message',
    'visitor',
    'like',
    'superlike',
    'match',
    'system',
    'payment',
    'vip',
    'verification',
    'ticket',
    'security',
    'reengagement'
  ) NOT NULL;
