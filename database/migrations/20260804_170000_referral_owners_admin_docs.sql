-- Phase 1+2: admin language preference, referral partners, admin doc upload
-- TiDB Cloud Serverless / MySQL 8.0 compatible
-- Run each statement independently; skip if already applied (duplicate column/key).

-- ── Admins: language preference (client ownership routing) ──────────────────
ALTER TABLE `admins`
  ADD COLUMN `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en'
    COMMENT 'Client language this admin owns/handles' AFTER `status`;

ALTER TABLE `admins`
  ADD KEY `idx_admins_preferred_language` (`preferred_language`);

-- ── Referrers / partners ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `referrers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category` ENUM('realtor_broker','one_off','affiliate_partner') NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `company` VARCHAR(255) DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL COMMENT 'Optional link when category=affiliate_partner',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_referrers_category` (`category`),
  KEY `idx_referrers_email` (`email`),
  KEY `idx_referrers_affiliate` (`affiliate_id`),
  KEY `idx_referrers_status` (`status`),
  CONSTRAINT `fk_referrers_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Clients: assigned owner + referral routing ───────────────────────────────
ALTER TABLE `clients`
  ADD COLUMN `assigned_admin_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Language-owner admin resolved from admins.preferred_language' AFTER `preferred_language`;

ALTER TABLE `clients`
  ADD COLUMN `referral_category` ENUM('realtor_broker','one_off','affiliate_partner') DEFAULT NULL
    COMMENT 'How this lead was referred; drives round-update routing' AFTER `affiliate_id`;

ALTER TABLE `clients`
  ADD COLUMN `referrer_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Partner who referred this client' AFTER `referral_category`;

ALTER TABLE `clients` ADD KEY `idx_clients_assigned_admin` (`assigned_admin_id`);
ALTER TABLE `clients` ADD KEY `idx_clients_referral_category` (`referral_category`);
ALTER TABLE `clients` ADD KEY `idx_clients_referrer` (`referrer_id`);

ALTER TABLE `clients`
  ADD CONSTRAINT `fk_clients_assigned_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL;

ALTER TABLE `clients`
  ADD CONSTRAINT `fk_clients_referrer`
    FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE SET NULL;

-- ── Admin-uploaded case documents ───────────────────────────────────────────
ALTER TABLE `client_documents`
  ADD COLUMN `uploaded_by_admin_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when staff uploads docs manually on a case' AFTER `reviewed_by_admin_id`;

ALTER TABLE `client_documents` ADD KEY `idx_client_docs_uploaded_by` (`uploaded_by_admin_id`);

ALTER TABLE `client_documents`
  ADD CONSTRAINT `fk_client_docs_uploaded_by`
    FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL;

-- ── Source labels for referral categories ───────────────────────────────────
INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`)
SELECT 'realtor_broker', 'Realtor / Mortgage Broker', 'Agente inmobiliario / Broker hipotecario', 'source', 'accent', 1, 41
WHERE NOT EXISTS (SELECT 1 FROM `labels` WHERE `slug` = 'realtor_broker');

INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`)
SELECT 'one_off_referral', 'One-off referral', 'Referido único', 'source', 'muted', 1, 42
WHERE NOT EXISTS (SELECT 1 FROM `labels` WHERE `slug` = 'one_off_referral');
