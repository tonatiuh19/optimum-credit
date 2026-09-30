-- Prepaid onboard invites: staff-minted single-use magic links for already-paid
-- unknown clients → self-serve intake → New Client column.
-- TiDB Cloud Serverless / MySQL 8.0 compatible.

CREATE TABLE IF NOT EXISTS `prepaid_onboard_invites` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` CHAR(64) NOT NULL COMMENT 'SHA-256 of raw invite token',
  `package_id` INT UNSIGNED NOT NULL,
  `paid_amount_cents` INT UNSIGNED NOT NULL COMMENT 'Already collected offline',
  `paid_label` VARCHAR(200) NOT NULL DEFAULT 'Enrollment (prepaid)',
  `payment_method` ENUM('cash','zelle','venmo','card_offline','other') NOT NULL DEFAULT 'other',
  `payment_note` VARCHAR(500) DEFAULT NULL,
  `remaining_splits_json` JSON DEFAULT NULL
    COMMENT 'Optional pending installments: [{label,amount_cents,due_date,send_payment_link?}]',
  `preferred_language` ENUM('en','es') DEFAULT NULL
    COMMENT 'NULL = client chooses on form',
  `referral_category` ENUM('realtor_broker','one_off','affiliate_partner') DEFAULT NULL,
  `referrer_id` INT UNSIGNED DEFAULT NULL,
  `staff_notes` TEXT DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `redeemed_at` DATETIME DEFAULT NULL,
  `redeemed_client_id` INT UNSIGNED DEFAULT NULL,
  `redeemed_case_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prepaid_onboard_token_hash` (`token_hash`),
  KEY `idx_prepaid_onboard_expires` (`expires_at`),
  KEY `idx_prepaid_onboard_creator` (`created_by_admin_id`),
  KEY `idx_prepaid_onboard_redeemed` (`redeemed_at`),
  CONSTRAINT `fk_prepaid_onboard_package`
    FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_prepaid_onboard_creator`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_prepaid_onboard_referrer`
    FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_prepaid_onboard_client`
    FOREIGN KEY (`redeemed_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_prepaid_onboard_case`
    FOREIGN KEY (`redeemed_case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
