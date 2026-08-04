-- Affiliates v1: admin role, profile expansion, attribution clicks, commissions ledger
-- TiDB Cloud Serverless (MySQL 8.0 compatible)
-- Idempotent-ish: safe to re-run column adds that already exist will error — apply once.

-- 1) Allow affiliate as an admin login role
ALTER TABLE `admins`
  MODIFY COLUMN `role` ENUM('super_admin','admin','agent','affiliate') NOT NULL DEFAULT 'admin';

-- 2) Expand affiliates profile (one ADD per statement — TiDB-safe)
ALTER TABLE `affiliates` ADD COLUMN `admin_id` INT UNSIGNED DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `slug` VARCHAR(64) DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `default_landing` ENUM('credit_analysis','pricing') NOT NULL DEFAULT 'credit_analysis';
ALTER TABLE `affiliates` ADD COLUMN `monthly_price_cents` INT UNSIGNED NOT NULL DEFAULT 20000;
ALTER TABLE `affiliates` ADD COLUMN `commission_rate_bps` INT UNSIGNED NOT NULL DEFAULT 1000;
ALTER TABLE `affiliates` ADD COLUMN `parent_override_rate_bps` INT UNSIGNED NOT NULL DEFAULT 500;
ALTER TABLE `affiliates` ADD COLUMN `subscription_status` ENUM('none','pending','active','past_due','cancelled','comped') NOT NULL DEFAULT 'none';
ALTER TABLE `affiliates` ADD COLUMN `anet_subscription_id` VARCHAR(64) DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `anet_customer_profile_id` VARCHAR(64) DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `anet_payment_profile_id` VARCHAR(64) DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `subscription_started_at` DATETIME DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `notes` TEXT DEFAULT NULL;

ALTER TABLE `affiliates` ADD UNIQUE KEY `uq_affiliates_admin` (`admin_id`);
ALTER TABLE `affiliates` ADD UNIQUE KEY `uq_affiliates_slug` (`slug`);
ALTER TABLE `affiliates` ADD KEY `idx_affiliates_subscription` (`subscription_status`);
ALTER TABLE `affiliates`
  ADD CONSTRAINT `fk_affiliates_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL;

-- Backfill slug from referral_code for any existing rows
UPDATE `affiliates`
SET `slug` = LOWER(`referral_code`)
WHERE `slug` IS NULL AND `referral_code` IS NOT NULL;

-- Suggested prices by plan (existing rows)
UPDATE `affiliates` SET `monthly_price_cents` = 20000, `commission_rate_bps` = 1000 WHERE `plan` = 'standard';
UPDATE `affiliates` SET `monthly_price_cents` = 50000, `commission_rate_bps` = 1500 WHERE `plan` = 'master';
UPDATE `affiliates` SET `monthly_price_cents` = 0, `commission_rate_bps` = 500, `parent_override_rate_bps` = 500 WHERE `plan` = 'sub_affiliate';

-- 3) Click / attribution events
CREATE TABLE IF NOT EXISTS `affiliate_link_clicks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `slug` VARCHAR(64) NOT NULL,
  `landing` ENUM('credit_analysis','pricing','other') NOT NULL DEFAULT 'other',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `referer` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_clicks_affiliate` (`affiliate_id`),
  KEY `idx_aff_clicks_created` (`created_at`),
  CONSTRAINT `fk_aff_clicks_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Commission ledger
CREATE TABLE IF NOT EXISTS `affiliate_commissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `payment_id` INT UNSIGNED DEFAULT NULL,
  `source_affiliate_id` INT UNSIGNED DEFAULT NULL,
  `kind` ENUM('enrollment','override','manual') NOT NULL DEFAULT 'enrollment',
  `amount_cents` INT NOT NULL,
  `rate_bps` INT UNSIGNED DEFAULT NULL,
  `base_amount_cents` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('pending','approved','paid','void') NOT NULL DEFAULT 'pending',
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_comm_affiliate` (`affiliate_id`),
  KEY `idx_aff_comm_client` (`client_id`),
  KEY `idx_aff_comm_status` (`status`),
  KEY `idx_aff_comm_payment` (`payment_id`),
  CONSTRAINT `fk_aff_comm_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_comm_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Source label for affiliate-attributed leads
INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`)
SELECT 'affiliate_referral', 'Affiliate referral', 'Referido de afiliado', 'source', 'primary', 1, 50
WHERE NOT EXISTS (SELECT 1 FROM `labels` WHERE `slug` = 'affiliate_referral');
