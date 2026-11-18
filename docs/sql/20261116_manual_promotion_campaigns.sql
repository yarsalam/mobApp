-- Manual discount campaigns and per-user wallet-checkout reservations.
-- Apply explicitly; production DB_SYNC must remain false.
CREATE TABLE IF NOT EXISTS `manual_promotion_campaigns` (
  `id` char(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `title` varchar(120) NOT NULL,
  `subtitle` varchar(280) NOT NULL,
  `ctaText` varchar(60) NOT NULL DEFAULT 'مشاهده پیشنهاد',
  `bundleCode` varchar(255) NOT NULL,
  `discountType` enum('percent','fixed') NOT NULL,
  `discountValue` int unsigned NOT NULL,
  `audienceType` enum('all','users','phases') NOT NULL,
  `audienceUserIds` json DEFAULT NULL,
  `audiencePhases` json DEFAULT NULL,
  `startsAt` datetime NOT NULL,
  `endsAt` datetime NOT NULL,
  `maxRedemptions` int unsigned DEFAULT NULL,
  `perUserLimit` int unsigned NOT NULL DEFAULT 1,
  `priority` int NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 0,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_manual_promotion_active_window` (`active`, `startsAt`, `endsAt`),
  KEY `IDX_manual_promotion_bundle` (`bundleCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `manual_promotion_redemptions` (
  `id` char(36) NOT NULL,
  `campaignId` char(36) NOT NULL,
  `userId` int unsigned NOT NULL,
  `bundleCode` varchar(255) NOT NULL,
  `checkoutKey` varchar(80) NOT NULL,
  `basePriceRials` int unsigned NOT NULL,
  `discountRials` int unsigned NOT NULL,
  `payablePriceRials` int unsigned NOT NULL,
  `status` enum('reserved','redeemed','released') NOT NULL DEFAULT 'reserved',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `redeemedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_manual_promotion_checkout` (`campaignId`, `userId`, `checkoutKey`),
  KEY `IDX_manual_promotion_campaign_status` (`campaignId`, `status`),
  KEY `IDX_manual_promotion_user_status` (`campaignId`, `userId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
