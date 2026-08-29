-- Multi-partner referrals (up to 3), CMS credential vault (SmartCredit + MyFreeScoreNow),
-- progress-report alert payload storage + notify event support.
-- TiDB: add columns one ALTER at a time (multi-ADD can fail).

-- ---------------------------------------------------------------------------
-- client_referrers: many referral partners per client (max 3 enforced in API)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `client_referrers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `referrer_id` INT UNSIGNED NOT NULL,
  `role` ENUM('primary','secondary','tertiary') NOT NULL DEFAULT 'primary',
  `sort_order` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–2 display order',
  `notify_on_round` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_referrers_pair` (`client_id`, `referrer_id`),
  KEY `idx_client_referrers_client` (`client_id`),
  KEY `idx_client_referrers_referrer` (`referrer_id`),
  CONSTRAINT `fk_client_referrers_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_referrers_referrer`
    FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from legacy single FK
INSERT INTO `client_referrers` (`client_id`, `referrer_id`, `role`, `sort_order`, `notify_on_round`)
SELECT c.id, c.referrer_id, 'primary', 0, 1
FROM `clients` c
WHERE c.referrer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `client_referrers` cr
    WHERE cr.client_id = c.id AND cr.referrer_id = c.referrer_id
  );

-- ---------------------------------------------------------------------------
-- CMS login vault on clients (SmartCredit + MyFreeScoreNow)
-- ---------------------------------------------------------------------------
ALTER TABLE `clients`
  ADD COLUMN `myfreescorenow_email` VARCHAR(255) DEFAULT NULL
    AFTER `smart_credit_connected_at`;

ALTER TABLE `clients`
  ADD COLUMN `cms_secrets_ciphertext` MEDIUMBLOB DEFAULT NULL
    AFTER `myfreescorenow_email`;

ALTER TABLE `clients`
  ADD COLUMN `cms_secrets_iv` VARCHAR(64) DEFAULT NULL
    AFTER `cms_secrets_ciphertext`;

ALTER TABLE `clients`
  ADD COLUMN `cms_secrets_tag` VARCHAR(64) DEFAULT NULL
    AFTER `cms_secrets_iv`;

-- ---------------------------------------------------------------------------
-- Persist progress-report QA alerts on published rounds
-- ---------------------------------------------------------------------------
ALTER TABLE `client_round_reports`
  ADD COLUMN `alerts_json` JSON DEFAULT NULL
    COMMENT 'Progress QA alerts: PII mismatch, closed still reporting, hard inquiries'
    AFTER `targets_json`;
