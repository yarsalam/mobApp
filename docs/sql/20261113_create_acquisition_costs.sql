-- Apply as a reviewed schema change before deploying the acquisition-growth backend.
-- Production DB_SYNC is disabled; this file is not applied automatically.
CREATE TABLE IF NOT EXISTS acquisition_costs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source VARCHAR(80) NOT NULL,
  medium VARCHAR(80) NULL,
  campaign VARCHAR(160) NULL,
  campaignId VARCHAR(120) NULL,
  category ENUM('media','content','labor','agency','tools','other') NOT NULL DEFAULT 'media',
  amount DECIMAL(18,2) NOT NULL,
  currency ENUM('IRT','USDT','BTC','USD') NOT NULL DEFAULT 'IRT',
  occurredAt TIMESTAMP NOT NULL,
  notes VARCHAR(500) NULL,
  createdBy VARCHAR(128) NULL,
  idempotencyKey VARCHAR(128) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acquisition_cost_idempotency (idempotencyKey),
  KEY idx_acquisition_cost_source_date (source, occurredAt),
  KEY idx_acquisition_cost_campaign_date (campaignId, occurredAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
