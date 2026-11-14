-- Reviewed schema change for remote FCM push and re-engagement notifications.
-- Apply only after this migration has been reviewed against the target database.
-- DB_SYNC must remain false in every production environment.

ALTER TABLE `user_device`
  ADD COLUMN `pushToken` VARCHAR(2048) NULL,
  ADD COLUMN `pushEnabled` TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX `IDX_user_device_user_push_enabled`
  ON `user_device` (`userId`, `pushEnabled`);

CREATE TABLE IF NOT EXISTS `user_push_state` (
  `user_id` INT NOT NULL,
  `last_push_sent_at` TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `FK_user_push_state_user`
    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
