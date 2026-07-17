-- Optimum Credit Database Schema
-- Last updated: 2026-04-28
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- This file mirrors the latest applied migrations and is the source of truth
-- for table structure. Modify via migrations under database/migrations/

-- ============================================================================
-- DROP placeholder users table from initial scaffold
-- ============================================================================
DROP TABLE IF EXISTS `users`;

-- ============================================================================
-- ADMINS (separate from clients) — Optimum Credit team members
-- ============================================================================
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `role` ENUM('super_admin','admin','agent') NOT NULL DEFAULT 'admin',
  `status` ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admins_status` (`status`),
  KEY `idx_admins_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_otp_admin_id` (`admin_id`),
  KEY `idx_admin_otp_expires` (`expires_at`),
  CONSTRAINT `fk_admin_otp_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL UNIQUE,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_sessions_admin` (`admin_id`),
  KEY `idx_admin_sessions_active` (`is_active`),
  KEY `idx_admin_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_admin_sessions_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- AFFILIATES (Phase 2 hook — created now so client.affiliate_id can FK)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `affiliates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `plan` ENUM('standard','master','sub_affiliate') NOT NULL DEFAULT 'standard',
  `parent_affiliate_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('invited','active','inactive','suspended') NOT NULL DEFAULT 'invited',
  `referral_code` VARCHAR(32) NOT NULL UNIQUE,
  `bio` TEXT DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `social_facebook` VARCHAR(255) DEFAULT NULL,
  `social_instagram` VARCHAR(255) DEFAULT NULL,
  `social_tiktok` VARCHAR(255) DEFAULT NULL,
  `social_linkedin` VARCHAR(255) DEFAULT NULL,
  `stripe_customer_id` VARCHAR(255) DEFAULT NULL,
  `stripe_subscription_id` VARCHAR(255) DEFAULT NULL,
  `setup_fee_paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_affiliates_referral` (`referral_code`),
  KEY `idx_affiliates_parent` (`parent_affiliate_id`),
  KEY `idx_affiliates_plan` (`plan`),
  KEY `idx_affiliates_status` (`status`),
  CONSTRAINT `fk_affiliates_parent` FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PACKAGES (service packages: Standard / Complex / Tradeline)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `packages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `subtitle` VARCHAR(150) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `price_cents` INT UNSIGNED NOT NULL,
  `compare_price_cents` INT UNSIGNED DEFAULT NULL COMMENT 'Original/list price for display (strikethrough)',
  `billing_interval` ENUM('one_time','monthly') NOT NULL DEFAULT 'one_time',
  `checkout_type` ENUM('fixed_price','tradeline_picker','subscription') NOT NULL DEFAULT 'fixed_price',
  `duration_months` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `features_json` JSON DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_packages_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `packages` (`slug`,`name`,`subtitle`,`description`,`price_cents`,`compare_price_cents`,`billing_interval`,`checkout_type`,`duration_months`,`features_json`,`is_active`,`sort_order`) VALUES
  ('standard','Standard Repair','Standard Credit Files','Best for standard credit files with common negative items. Covers the most common negative credit items and standard dispute needs in one flat payment.',149700,199000,'one_time','fixed_price',5,
   JSON_ARRAY('Late Payments','Collections','Hard Inquiries','Charge-Offs','Personal Info Errors','Incorrect Balances','Duplicate Accounts'),1,1),
  ('complex','Complex Repair','Serious Derogatory Items','Best for files with serious derogatory items requiring advanced strategy. Includes everything in Standard Repair plus more complex negative items that require a stronger approach.',249700,299000,'one_time','fixed_price',5,
   JSON_ARRAY('Everything in Standard Repair','Chapter 7 & 13 Bankruptcies','Student Loans','Tax Liens','Medical Bills','Judgments & Foreclosures','Foreclosures','Repossessions','Bureau Inconsistencies','Charge-Offs (advanced furnisher disputes)','Identity & Fraud Items'),1,2),
  ('tradeline','Tradeline','High-Impact Credit Boost','Select authorized-user tradelines below. Total is based on your selections.',0,NULL,'one_time','tradeline_picker',5,
   JSON_ARRAY('Consultation — review your profile and recommend trade lines','Account Placement — authorized user on a seasoned account','Reporting — updates on your credit report in 30–60 days'),1,3),
  ('inquiries_removal','Inquiries Removal','Expedited','Get negative inquiries removed from your credit report. We work to remove hard inquiries that negatively impact your credit score.',60000,80000,'one_time','fixed_price',1,
   JSON_ARRAY('Fast & reliable hard inquiry removal','Increase your credit score','Professional dispute process with bureaus and creditors','Submit your request with credit report details','We handle all disputes with the bureaus','See results in 30–60 days on your updated report'),1,4),
  ('peace_of_mind','Peace of Mind Plan','Exclusive for Optimum Clients','Unlimited support and priority service for clients who have completed credit repair. Eligibility: available after completing a credit repair service.',4999,8000,'monthly','subscription',1,
   JSON_ARRAY('Unlimited credit repair support','Priority service and faster response times','Continuous credit monitoring & disputes','Hassle-free assistance — no extra charges'),1,5)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

CREATE TABLE IF NOT EXISTS `tradeline_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL UNIQUE,
  `name` VARCHAR(120) NOT NULL,
  `details` TEXT NOT NULL,
  `price_cents` INT UNSIGNED NOT NULL,
  `compare_price_cents` INT UNSIGNED DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tradeline_products_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tradeline_products` (`slug`, `name`, `details`, `price_cents`, `compare_price_cents`, `sort_order`) VALUES
  ('capital_one', 'CapitalOne', '$3000 credit limit, 4 years', 105000, 150000, 1),
  ('barclays_aviator', 'Barclays Aviator', 'Limit $21200, Age: 3 Yrs, Statement Date: 16TH, Post Date: 19TH', 125000, 160000, 2),
  ('pnc_bank', 'PNC Bank', 'Limit $17500, Age: 3 Yrs, Statement Date: 1ST, Post Date: 10TH', 125000, 160000, 3),
  ('us_bank_2020_20k', '2020 US Bank 20K', 'Limit $20000, Age: 5 Yrs, Statement/Closing Date: 3rd', 192500, 240000, 4),
  ('chase_2022_18k', '2022 Chase 18K', 'Limit $18000, Almost 3 years, Statement/Closing Date: 18th', 175000, 220000, 5),
  ('capital_one_2022_13_5k', '2022 CapitalOne 13.5K', '$13,500 credit limit, 3 years History, Closing 2nd', 165000, 220000, 6),
  ('us_bank_2015_20k', '2015 US BANK 20k', 'Limit $20000, Age: 10.5 Yrs, Statement/Closing Date: 1ST', 207500, 250000, 7),
  ('us_bank_2019_16_2k', '2019 US Bank 16.2K', 'Limit $16200, Age: 6.5 Yrs, Statement/Closing Date: 2nd', 189500, 220000, 8)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

CREATE TABLE IF NOT EXISTS `client_tradeline_selections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `payment_id` INT UNSIGNED NOT NULL,
  `tradeline_product_id` INT UNSIGNED NOT NULL,
  `product_name` VARCHAR(120) NOT NULL,
  `product_details` TEXT NOT NULL,
  `price_cents` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tradeline_sel_client` (`client_id`),
  KEY `idx_tradeline_sel_payment` (`payment_id`),
  CONSTRAINT `fk_tradeline_sel_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tradeline_sel_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tradeline_sel_product` FOREIGN KEY (`tradeline_product_id`) REFERENCES `tradeline_products`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_subscriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `package_id` INT UNSIGNED NOT NULL,
  `anet_subscription_id` VARCHAR(64) NOT NULL,
  `status` ENUM('active','cancelled','suspended','expired') NOT NULL DEFAULT 'active',
  `amount_cents` INT UNSIGNED NOT NULL,
  `billing_interval` ENUM('monthly') NOT NULL DEFAULT 'monthly',
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `next_billing_at` DATE DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_sub_anet` (`anet_subscription_id`),
  KEY `idx_client_sub_client` (`client_id`),
  KEY `idx_client_sub_status` (`status`),
  CONSTRAINT `fk_client_sub_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_sub_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CLIENTS (replaces placeholder `users`)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  `zip` VARCHAR(20) DEFAULT NULL,
  `ssn_last4` CHAR(4) DEFAULT NULL,
  `date_of_birth` DATE DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  -- Pipeline / process
  `package_id` INT UNSIGNED DEFAULT NULL,
  `pipeline_stage` ENUM(
    'new_client','docs_ready','round_1','round_2','round_3','round_4','round_5','completed','cancelled'
  ) NOT NULL DEFAULT 'new_client',
  `pipeline_stage_changed_at` DATETIME DEFAULT NULL,
  -- Affiliate referral
  `affiliate_id` INT UNSIGNED DEFAULT NULL,
  -- Smart Credit
  `smart_credit_email` VARCHAR(255) DEFAULT NULL,
  `smart_credit_connected_at` DATETIME DEFAULT NULL,
  -- Contract / e-signature
  `contract_signed_at` DATETIME DEFAULT NULL,
  `contract_signature_name` VARCHAR(150) DEFAULT NULL,
  `contract_signature_ip` VARCHAR(45) DEFAULT NULL,
  -- Stripe
  `stripe_customer_id` VARCHAR(255) DEFAULT NULL,
  -- Authorize.net — populated after first successful charge
  `anet_customer_profile_id` VARCHAR(64) DEFAULT NULL,
  `anet_payment_profile_id` VARCHAR(64) DEFAULT NULL,
  -- Status
  `status` ENUM('pending_payment','onboarding','active','paused','cancelled') NOT NULL DEFAULT 'pending_payment',
  `admin_notes` TEXT DEFAULT NULL COMMENT 'Internal notes visible only to admins',
  -- Credit Repair Cloud integration
  `crc_client_id` VARCHAR(64) DEFAULT NULL COMMENT 'Base64-encoded CRC lead/client ID from CRC API',
  `crc_synced_at` DATETIME DEFAULT NULL COMMENT 'Last successful sync with CRC API',
  `email_verified_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_clients_status` (`status`),
  KEY `idx_clients_pipeline_stage` (`pipeline_stage`),
  KEY `idx_clients_package` (`package_id`),
  KEY `idx_clients_affiliate` (`affiliate_id`),
  KEY `idx_clients_crc_id` (`crc_client_id`),
  CONSTRAINT `fk_clients_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify','onboarding') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_otp_client` (`client_id`),
  KEY `idx_client_otp_expires` (`expires_at`),
  CONSTRAINT `fk_client_otp_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL UNIQUE,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_sessions_client` (`client_id`),
  KEY `idx_client_sessions_active` (`is_active`),
  KEY `idx_client_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_client_sessions_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PAYMENTS (Authorize.net)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `package_id` INT UNSIGNED DEFAULT NULL,
  `case_id` INT UNSIGNED DEFAULT NULL COMMENT 'Linked credit repair case, set when payment originates from a split',
  `split_id` INT UNSIGNED DEFAULT NULL COMMENT 'payment_splits row that triggered this charge',
  `amount_cents` INT UNSIGNED NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'USD',
  `status` ENUM('pending','succeeded','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
  `provider` ENUM('stripe','authorize_net','manual') NOT NULL DEFAULT 'authorize_net',
  `provider_transaction_id` VARCHAR(255) DEFAULT NULL UNIQUE,
  `provider_charge_id` VARCHAR(255) DEFAULT NULL,
  `failure_reason` TEXT DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_client` (`client_id`),
  KEY `idx_payments_status` (`status`),
  KEY `idx_payments_paid_at` (`paid_at`),
  CONSTRAINT `fk_payments_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_split` FOREIGN KEY (`split_id`) REFERENCES `payment_splits`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CREDIT REPAIR CASES (one per engagement / package purchase)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `credit_repair_cases` (
  `id`                        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `case_number`               VARCHAR(20)   DEFAULT NULL UNIQUE COMMENT 'e.g. CR-00001; set after INSERT via UPDATE',
  `client_id`                 INT UNSIGNED  NOT NULL,
  `package_id`                INT UNSIGNED  DEFAULT NULL,
  `pipeline_stage`            ENUM('new_client','docs_ready','round_1','round_2','round_3','round_4','round_5','completed','cancelled')
                                            NOT NULL DEFAULT 'new_client',
  `pipeline_stage_changed_at` DATETIME      DEFAULT NULL,
  `status`                    ENUM('active','completed','cancelled','on_hold')
                                            NOT NULL DEFAULT 'active',
  `notes`                     TEXT          DEFAULT NULL,
  `created_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cases_client`  (`client_id`),
  KEY `idx_cases_stage`   (`pipeline_stage`),
  KEY `idx_cases_status`  (`status`),
  CONSTRAINT `fk_cases_client`  FOREIGN KEY (`client_id`)  REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cases_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- DOCUMENTS (ID, SSN card, proof of address)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `case_id` INT UNSIGNED DEFAULT NULL,
  `doc_type` ENUM('id_front','id_back','ssn_card','proof_of_address','other') NOT NULL,
  `pipeline_round` VARCHAR(30) DEFAULT NULL COMMENT 'Pipeline stage this document is linked to (e.g. round_1)',
  `file_name` VARCHAR(255) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `storage_provider` ENUM('local','s3','r2','cdn') NOT NULL DEFAULT 'local',
  `storage_key` VARCHAR(500) NOT NULL,
  `encrypted` TINYINT(1) NOT NULL DEFAULT 1,
  `enc_iv` CHAR(32) DEFAULT NULL COMMENT 'AES-256-GCM IV (16 bytes hex)',
  `enc_tag` CHAR(32) DEFAULT NULL COMMENT 'AES-256-GCM auth tag (16 bytes hex)',
  `review_status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `rejection_reason` TEXT DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_docs_client` (`client_id`),
  KEY `idx_client_docs_case` (`case_id`),
  KEY `idx_client_docs_status` (`review_status`),
  KEY `idx_client_docs_type` (`doc_type`),
  CONSTRAINT `fk_client_docs_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_docs_admin` FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_docs_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ONBOARDING TOKENS (magic link sent in welcome email after payment)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `onboarding_tokens` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`    INT UNSIGNED NOT NULL,
  `token_hash`   CHAR(64)     NOT NULL UNIQUE COMMENT 'SHA-256 of the raw token',
  `expires_at`   DATETIME     NOT NULL,
  `consumed_at`  DATETIME     DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_onboarding_tokens_client`  (`client_id`),
  KEY `idx_onboarding_tokens_expires` (`expires_at`),
  CONSTRAINT `fk_onboarding_tokens_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CONTRACT (signed e-signature record + uploaded PDF if any)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_contracts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0',
  `body_html` MEDIUMTEXT NOT NULL,
  `signed_name` VARCHAR(150) DEFAULT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL,
  `signature_data_url` MEDIUMTEXT DEFAULT NULL,
  `pdf_storage_key` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_contracts_client` (`client_id`),
  CONSTRAINT `fk_client_contracts_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- MONTHLY ROUND REPORTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_round_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `case_id` INT UNSIGNED DEFAULT NULL,
  `round_number` TINYINT UNSIGNED NOT NULL,
  `score_before` SMALLINT UNSIGNED DEFAULT NULL,
  `score_after` SMALLINT UNSIGNED DEFAULT NULL,
  `items_removed` INT UNSIGNED NOT NULL DEFAULT 0,
  `items_disputed` INT UNSIGNED NOT NULL DEFAULT 0,
  `summary_md` MEDIUMTEXT DEFAULT NULL,
  `bureau_scores_json` JSON DEFAULT NULL,
  `wins_json` JSON DEFAULT NULL COMMENT 'removed items table rows',
  `targets_json` JSON DEFAULT NULL COMMENT 'round targets still on report',
  `utilization_json` JSON DEFAULT NULL,
  `action_plan_json` JSON DEFAULT NULL,
  `file_strength_score` TINYINT UNSIGNED DEFAULT NULL,
  `wizard_session_id` INT UNSIGNED DEFAULT NULL,
  `report_locale` ENUM('en','es') NOT NULL DEFAULT 'en',
  `pdf_storage_key` VARCHAR(500) DEFAULT NULL,
  `pdf_file_name` VARCHAR(255) DEFAULT NULL,
  `pdf_storage_provider` ENUM('local','cdn') DEFAULT 'cdn',
  `pdf_encrypted` TINYINT(1) NOT NULL DEFAULT 0,
  `pdf_enc_iv` CHAR(32) DEFAULT NULL COMMENT 'AES-256-GCM IV (16 bytes hex)',
  `pdf_enc_tag` CHAR(32) DEFAULT NULL COMMENT 'AES-256-GCM auth tag (16 bytes hex)',
  `pdf_uploaded_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `delivered_via_sms` TINYINT(1) NOT NULL DEFAULT 0,
  `delivered_via_email` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_round` (`client_id`,`round_number`),
  KEY `idx_round_reports_client` (`client_id`),
  CONSTRAINT `fk_round_reports_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_round_reports_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reports_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ROUND REPORT PDFs (multiple attachments per round)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `round_report_pdfs` (
  `id`                  INT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `client_id`           INT UNSIGNED        NOT NULL,
  `round_number`        TINYINT UNSIGNED    NOT NULL,
  `round_report_id`     INT UNSIGNED        DEFAULT NULL,
  `file_name`           VARCHAR(255)        NOT NULL,
  `storage_key`         VARCHAR(500)        NOT NULL,
  `storage_provider`    ENUM('local','cdn') NOT NULL DEFAULT 'cdn',
  `encrypted`           TINYINT(1)          NOT NULL DEFAULT 0,
  `enc_iv`              CHAR(32)            DEFAULT NULL,
  `enc_tag`             CHAR(32)            DEFAULT NULL,
  `uploaded_by_admin_id` INT UNSIGNED       DEFAULT NULL,
  `uploaded_at`         DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rrp_client_round` (`client_id`, `round_number`),
  INDEX `idx_rrp_round_report` (`round_report_id`),
  CONSTRAINT `fk_rrp_client` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================================
-- OFG PROGRESS REPORT WIZARD
-- ============================================================================
CREATE TABLE IF NOT EXISTS `report_wizard_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `round_number` TINYINT UNSIGNED NOT NULL,
  `status` ENUM('draft','extracting','review','generating','published','failed') NOT NULL DEFAULT 'draft',
  `before_pdf_id` INT UNSIGNED DEFAULT NULL,
  `after_pdf_id` INT UNSIGNED DEFAULT NULL,
  `options_json` JSON DEFAULT NULL,
  `extracted_json` JSON DEFAULT NULL,
  `reviewed_json` JSON DEFAULT NULL,
  `extraction_meta` JSON DEFAULT NULL,
  `output_pdf_id` INT UNSIGNED DEFAULT NULL,
  `round_report_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `compliance_acknowledged_at` DATETIME DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rws_case` (`case_id`),
  KEY `idx_rws_client` (`client_id`),
  KEY `idx_rws_status` (`status`),
  CONSTRAINT `fk_rws_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rws_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rws_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `round_report_source_pdfs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` INT UNSIGNED NOT NULL,
  `role` ENUM('before','after') NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `storage_key` VARCHAR(500) NOT NULL,
  `storage_provider` ENUM('local','cdn') NOT NULL DEFAULT 'cdn',
  `encrypted` TINYINT(1) NOT NULL DEFAULT 1,
  `enc_iv` CHAR(32) NOT NULL,
  `enc_tag` CHAR(32) NOT NULL,
  `uploaded_by_admin_id` INT UNSIGNED NOT NULL,
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rrsp_session` (`session_id`),
  CONSTRAINT `fk_rrsp_session` FOREIGN KEY (`session_id`) REFERENCES `report_wizard_sessions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PIPELINE STAGE HISTORY (audit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_pipeline_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `from_stage` VARCHAR(50) DEFAULT NULL,
  `to_stage` VARCHAR(50) NOT NULL,
  `changed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pipeline_history_client` (`client_id`),
  KEY `idx_pipeline_history_created` (`created_at`),
  CONSTRAINT `fk_pipeline_history_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pipeline_history_admin` FOREIGN KEY (`changed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CRC SYNC LOG (Credit Repair Cloud integration audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `crc_sync_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `action` ENUM('push_create','push_update','pull','webhook_stage_update') NOT NULL,
  `crc_client_id` VARCHAR(64) DEFAULT NULL,
  `pipeline_stage` VARCHAR(50) DEFAULT NULL,
  `status` ENUM('success','error') NOT NULL DEFAULT 'success',
  `error_message` TEXT DEFAULT NULL,
  `payload` JSON DEFAULT NULL COMMENT 'Request/response payload for debugging',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_crc_sync_client` (`client_id`),
  KEY `idx_crc_sync_action` (`action`),
  KEY `idx_crc_sync_created` (`created_at`),
  CONSTRAINT `fk_crc_sync_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CONVERSATIONS (Twilio SMS / Calls + Email)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `channel` ENUM('sms','call','email','internal') NOT NULL DEFAULT 'sms',
  `last_message_at` DATETIME DEFAULT NULL,
  `last_message_preview` VARCHAR(500) DEFAULT NULL,
  `unread_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('open','closed','archived') NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversations_client` (`client_id`),
  KEY `idx_conversations_assigned` (`assigned_admin_id`),
  KEY `idx_conversations_status` (`status`),
  CONSTRAINT `fk_conversations_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_conversations_admin` FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` INT UNSIGNED NOT NULL,
  `direction` ENUM('inbound','outbound') NOT NULL,
  `channel` ENUM('sms','call','email','internal','whatsapp') NOT NULL DEFAULT 'sms',
  `body` MEDIUMTEXT DEFAULT NULL,
  `from_address` VARCHAR(255) DEFAULT NULL,
  `to_address` VARCHAR(255) DEFAULT NULL,
  `provider_message_id` VARCHAR(255) DEFAULT NULL,
  `provider_status` VARCHAR(50) DEFAULT NULL,
  `call_duration_sec` INT UNSIGNED DEFAULT NULL,
  `recording_url` VARCHAR(500) DEFAULT NULL,
  `sent_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_messages_conversation` (`conversation_id`),
  KEY `idx_messages_created` (`created_at`),
  KEY `idx_messages_provider` (`provider_message_id`),
  CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_messages_admin` FOREIGN KEY (`sent_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SUPPORT TICKETS (Optibot escalation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `support_tickets` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `category` ENUM('billing','documents','process','technical','other') NOT NULL DEFAULT 'other',
  `priority` ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  `status` ENUM('open','in_progress','waiting_client','resolved','closed') NOT NULL DEFAULT 'open',
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tickets_client` (`client_id`),
  KEY `idx_tickets_status` (`status`),
  KEY `idx_tickets_assigned` (`assigned_admin_id`),
  CONSTRAINT `fk_tickets_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tickets_admin` FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `support_ticket_replies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` INT UNSIGNED NOT NULL,
  `author_type` ENUM('client','admin','system') NOT NULL,
  `author_client_id` INT UNSIGNED DEFAULT NULL,
  `author_admin_id` INT UNSIGNED DEFAULT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `is_internal_note` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_replies_ticket` (`ticket_id`),
  CONSTRAINT `fk_ticket_replies_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SUPPORT FAQ — admin-managed FAQ items shown on client support page
-- ============================================================================
CREATE TABLE IF NOT EXISTS `support_faq` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `question` VARCHAR(512) NOT NULL,
  `answer` MEDIUMTEXT NOT NULL,
  `category` ENUM('billing','documents','process','technical','general') NOT NULL DEFAULT 'general',
  `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_faq_active_order` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- AI CHAT (Optibot) — conversation history
-- ============================================================================
CREATE TABLE IF NOT EXISTS `ai_chat_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) DEFAULT NULL,
  `language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_sessions_client` (`client_id`),
  CONSTRAINT `fk_ai_sessions_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_chat_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` INT UNSIGNED NOT NULL,
  `role` ENUM('user','assistant','system') NOT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `tokens_used` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_messages_session` (`session_id`),
  CONSTRAINT `fk_ai_messages_session` FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- EDUCATIONAL VIDEOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS `educational_videos` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `content_type` ENUM('video','pdf','image','article') NOT NULL DEFAULT 'video',
  `description` TEXT DEFAULT NULL,
  `video_url` VARCHAR(500) DEFAULT NULL,
  `file_url` VARCHAR(500) DEFAULT NULL COMMENT 'CDN URL for uploaded file (pdf, image, video)',
  `thumbnail_url` VARCHAR(500) DEFAULT NULL,
  `duration_seconds` INT UNSIGNED DEFAULT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_videos_published` (`is_published`),
  KEY `idx_videos_category` (`category`),
  KEY `idx_videos_content_type` (`content_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SMS / EMAIL TEMPLATES (admin-editable)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `communication_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(100) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `channel` ENUM('email','sms') NOT NULL,
  `subject` VARCHAR(255) DEFAULT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `variables_json` JSON DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_templates_channel` (`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `communication_templates` (`slug`,`name`,`channel`,`subject`,`body`,`variables_json`) VALUES
  ('welcome_email','Welcome Email','email','Welcome to Optimum Credit, {{first_name}}!','<h1>Welcome {{first_name}}</h1><p>Your {{package_name}} package is confirmed. Click <a href="{{onboarding_link}}">here</a> to upload your documents.</p>', JSON_ARRAY('first_name','package_name','onboarding_link')),
  ('sms_day1','New Client SMS Day 1','sms',NULL,'Hi {{first_name}}, welcome to Optimum Credit! Please upload your documents to get started: {{onboarding_link}}', JSON_ARRAY('first_name','onboarding_link')),
  ('sms_day2','New Client SMS Day 2','sms',NULL,'Reminder: We are waiting for your documents. Only takes a few minutes: {{onboarding_link}}', JSON_ARRAY('onboarding_link')),
  ('sms_day3','New Client SMS Day 3','sms',NULL,'Final reminder: Please upload your documents today so we can begin: {{onboarding_link}}', JSON_ARRAY('onboarding_link')),
  ('sms_round_complete','Round Complete SMS','sms',NULL,'{{first_name}}, your Round {{round_number}} report is ready! View progress: {{report_link}}', JSON_ARRAY('first_name','round_number','report_link')),
  ('sms_doc_rejected','Doc Rejected SMS','sms',NULL,'{{first_name}}, your document was rejected: {{reason}}. Please re-upload: {{onboarding_link}}', JSON_ARRAY('first_name','reason','onboarding_link')),
  ('email_round_complete','Round Complete Email','email','Your Round {{round_number}} report is ready','<h1>Round {{round_number}} Complete</h1><p>{{first_name}}, see your latest progress in your client portal.</p>', JSON_ARRAY('first_name','round_number')),
  -- Flow templates (EN) — seeded by 20260506_000000_reminder_flows.sql
  ('flow_new_client_day1','[Flow] New Client — Day 1 Welcome','email','Welcome to Optimum Credit, {{first_name}}! Upload your documents to start.','',JSON_ARRAY('first_name','portal_url')),
  ('flow_new_client_day2','[Flow] New Client — Day 2 Reminder','email','Reminder: We are waiting for your documents, {{first_name}}','',JSON_ARRAY('first_name','portal_url')),
  ('flow_new_client_day3','[Flow] New Client — Day 3 Final Reminder','email','Final reminder: Please upload your documents today, {{first_name}}','',JSON_ARRAY('first_name','portal_url')),
  ('flow_round_1_complete','[Flow] Round 1 Progress Report','email','Your Round 1 progress report is ready, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_2_complete','[Flow] Round 2 Progress Report','email','Your Round 2 progress report is ready, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_3_complete','[Flow] Round 3 Progress Report','email','Your Round 3 progress report is ready, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_4_complete','[Flow] Round 4 Progress Report','email','Your Round 4 progress report is ready, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_5_complete','[Flow] Round 5 Final Report','email','Your final progress report is ready, {{first_name}}!','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_completed','[Flow] Credit Repair Complete','email','Your credit repair journey is complete, {{first_name}}!','',JSON_ARRAY('first_name','portal_url')),
  -- Flow templates (ES) — seeded by 20260520_000000_reminder_flow_spanish_templates.sql
  ('flow_new_client_day1_es','[Flow] Nuevo Cliente — Día 1 Bienvenida (ES)','email','¡Bienvenido a Optimum Credit, {{first_name}}! Sube tus documentos para comenzar.','',JSON_ARRAY('first_name','portal_url')),
  ('flow_new_client_day2_es','[Flow] Nuevo Cliente — Día 2 Recordatorio (ES)','email','Recordatorio: Estamos esperando tus documentos, {{first_name}}','',JSON_ARRAY('first_name','portal_url')),
  ('flow_new_client_day3_es','[Flow] Nuevo Cliente — Día 3 Recordatorio Final (ES)','email','Recordatorio final: Por favor sube tus documentos hoy, {{first_name}}','',JSON_ARRAY('first_name','portal_url')),
  ('flow_round_1_complete_es','[Flow] Informe de Progreso Ronda 1 (ES)','email','Tu informe de progreso de la Ronda 1 está listo, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_2_complete_es','[Flow] Informe de Progreso Ronda 2 (ES)','email','Tu informe de progreso de la Ronda 2 está listo, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_3_complete_es','[Flow] Informe de Progreso Ronda 3 (ES)','email','Tu informe de progreso de la Ronda 3 está listo, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_4_complete_es','[Flow] Informe de Progreso Ronda 4 (ES)','email','Tu informe de progreso de la Ronda 4 está listo, {{first_name}}','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_round_5_complete_es','[Flow] Informe Final Ronda 5 (ES)','email','¡Tu informe final de progreso está listo, {{first_name}}!','',JSON_ARRAY('first_name','portal_url','items_removed','score_change')),
  ('flow_completed_es','[Flow] Reparación de Crédito Completada (ES)','email','¡Tu proceso de reparación de crédito está completo, {{first_name}}!','',JSON_ARRAY('first_name','portal_url'))
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- ============================================================================
-- NOTIFICATIONS QUEUE (scheduled SMS/Email automations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `notification_queue` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `channel` ENUM('email','sms','push','in_app') NOT NULL,
  `template_slug` VARCHAR(100) DEFAULT NULL,
  `to_address` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) DEFAULT NULL,
  `body` MEDIUMTEXT DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL,
  `scheduled_for` DATETIME NOT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `status` ENUM('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` TEXT DEFAULT NULL,
  `provider_message_id` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_status_scheduled` (`status`,`scheduled_for`),
  KEY `idx_notif_client` (`client_id`),
  CONSTRAINT `fk_notif_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notif_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_type` ENUM('client','admin','system','affiliate') NOT NULL,
  `actor_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) DEFAULT NULL,
  `entity_id` INT UNSIGNED DEFAULT NULL,
  `changes_json` JSON DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `status` ENUM('success','failure','warning') NOT NULL DEFAULT 'success',
  `error_message` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_type`,`actor_id`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SYSTEM SETTINGS (global key/value config)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` MEDIUMTEXT DEFAULT NULL,
  `description` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `system_settings` (`setting_key`,`setting_value`,`description`) VALUES
  ('contract_template_html','<h1>Optimum Credit Repair Service Agreement</h1><p>This agreement is entered into between Optimum Credit Repair LLC and the undersigned client.</p><p>By signing below, the client authorizes Optimum Credit Repair to act on their behalf for credit disputes...</p>','Default service agreement HTML body'),
  ('company_name','Optimum Credit Repair','Company display name'),
  ('support_email','support@optimumcreditrepair.com','Public-facing support email')
ON DUPLICATE KEY UPDATE `setting_value`=VALUES(`setting_value`);

-- ============================================================================
-- SECTION LOCKS (toggle admin panel sections on/off from the database)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `section_locks` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `section_key`          VARCHAR(50)  NOT NULL UNIQUE
                           COMMENT 'Matches the nav route key, e.g. conversations',
  `label`                VARCHAR(100) NOT NULL
                           COMMENT 'Human-readable section name shown in settings UI',
  `is_locked`            TINYINT(1)   NOT NULL DEFAULT 0,
  `lock_reason`          VARCHAR(255) DEFAULT NULL
                           COMMENT 'Optional message shown to admins when section is locked',
  `updated_by_admin_id`  INT UNSIGNED DEFAULT NULL,
  `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_section_locks_key` (`section_key`),
  CONSTRAINT `fk_section_locks_admin`
    FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`) VALUES
  ('documents',       'Doc Review',      0, NULL),
  ('conversations',   'Conversations',   1, 'Coming soon — messaging system is under construction.'),
  ('tickets',         'Support',         0, NULL),
  ('templates',       'Templates',       0, NULL),
  ('videos',          'Videos',          0, NULL),
  ('reminder-flows',  'Reminder Flows',  0, NULL),
  ('reports',         'Reports',         0, NULL),
  ('people',          'People',          0, NULL),
  ('portal_dashboard', 'Portal — Dashboard',         1, 'Coming soon — client dashboard is under construction.'),
  ('portal_contract',  'Portal — Service Agreement', 1, 'Coming soon — contracts module is under construction.'),
  ('portal_reports',   'Portal — Progress Reports',  1, 'Coming soon — reports are under construction.'),
  ('portal_optibot',   'Portal — Optibot AI',        1, 'Coming soon — AI assistant is under construction.'),
  ('portal_videos',    'Portal — Education',         1, 'Coming soon — education centre is under construction.'),
  ('portal_support',   'Portal — Support',           1, 'Coming soon — support tickets are under construction.'),
  ('portal_profile',   'Portal — My Profile',        1, 'Coming soon — profile page is under construction.')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

-- ============================================================================
-- REMINDER FLOWS (automated email sequences per pipeline trigger)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `reminder_flows` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `trigger_event` ENUM('payment_confirmed','docs_ready','round_1_complete','round_2_complete','round_3_complete','round_4_complete','round_5_complete','completed','payment_due') NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_trigger_event` (`trigger_event`),
  INDEX `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_steps` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `step_order` INT NOT NULL DEFAULT 0,
  `step_type` ENUM('send_email','internal_alert') NOT NULL DEFAULT 'send_email',
  `delay_days` INT NOT NULL DEFAULT 0,
  `label` VARCHAR(200) DEFAULT NULL,
  `subject` VARCHAR(500) DEFAULT NULL,
  `body` MEDIUMTEXT DEFAULT NULL,
  `template_slug` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_rfs_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows` (`id`) ON DELETE CASCADE,
  INDEX `idx_flow_order` (`flow_id`,`step_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PAYMENT SPLITS (installment schedule per credit repair case)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payment_splits` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id`              INT UNSIGNED NOT NULL,
  `client_id`            INT UNSIGNED NOT NULL  COMMENT 'Denormalised for fast queries',
  `label`                VARCHAR(200) NOT NULL  DEFAULT 'Payment',
  `amount_cents`         INT UNSIGNED NOT NULL,
  `currency`             CHAR(3)      NOT NULL  DEFAULT 'USD',
  `due_date`             DATE         NOT NULL,
  `status`               ENUM('pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  `completion_source`    ENUM('authorize_link','manual') DEFAULT NULL,
  `paid_at`              DATETIME     DEFAULT NULL,
  `payments_id`          INT UNSIGNED DEFAULT NULL,
  `reminder_flow_id`     INT UNSIGNED DEFAULT NULL,
  `send_payment_link`    TINYINT(1)   NOT NULL DEFAULT 0,
  `notes`                TEXT         DEFAULT NULL,
  `created_by_admin_id`  INT UNSIGNED DEFAULT NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_splits_case`     (`case_id`),
  KEY `idx_splits_client`   (`client_id`),
  KEY `idx_splits_status`   (`status`),
  KEY `idx_splits_due_date` (`due_date`),
  CONSTRAINT `fk_splits_case`    FOREIGN KEY (`case_id`)    REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_splits_client`  FOREIGN KEY (`client_id`)  REFERENCES `clients`(`id`)             ON DELETE CASCADE,
  CONSTRAINT `fk_splits_payment` FOREIGN KEY (`payments_id`) REFERENCES `payments`(`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_splits_flow`    FOREIGN KEY (`reminder_flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_splits_admin`   FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PAYMENT SPLIT TOKENS (secure one-time payment links per split)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payment_split_tokens` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `split_id`   INT UNSIGNED NOT NULL,
  `token`      CHAR(36)     NOT NULL UNIQUE COMMENT 'UUID v4',
  `expires_at` DATETIME     NOT NULL,
  `used_at`    DATETIME     DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_split_tokens_token`   (`token`),
  KEY `idx_split_tokens_split`   (`split_id`),
  KEY `idx_split_tokens_expires` (`expires_at`),
  CONSTRAINT `fk_split_tokens_split`
    FOREIGN KEY (`split_id`) REFERENCES `payment_splits`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- COUPONS (promotional discount codes applied at registration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `coupons` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`                   VARCHAR(50)  NOT NULL UNIQUE COMMENT 'Uppercase promo code, e.g. SAVE20',
  `description`            VARCHAR(255) DEFAULT NULL,
  `discount_type`          ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage',
  `discount_value`         INT UNSIGNED NOT NULL COMMENT 'Percent (0-100) or cents amount',
  `min_amount_cents`       INT UNSIGNED NOT NULL DEFAULT 0,
  `max_uses`               INT UNSIGNED DEFAULT NULL COMMENT 'NULL = unlimited',
  `uses_count`             INT UNSIGNED NOT NULL DEFAULT 0,
  `applicable_packages`    JSON DEFAULT NULL COMMENT 'Array of package IDs; NULL means all',
  `valid_from`             DATETIME DEFAULT NULL,
  `expires_at`             DATETIME DEFAULT NULL,
  `is_active`              TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id`    INT UNSIGNED DEFAULT NULL,
  `created_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_coupons_code`   (`code`),
  KEY `idx_coupons_active` (`is_active`),
  KEY `idx_coupons_expires`(`expires_at`),
  CONSTRAINT `fk_coupons_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_executions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `triggered_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` ENUM('completed','partial','failed') NOT NULL DEFAULT 'completed',
  `steps_executed` INT NOT NULL DEFAULT 0,
  `steps_scheduled` INT NOT NULL DEFAULT 0,
  `error_message` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rfe_flow` (`flow_id`),
  INDEX `idx_rfe_client` (`client_id`),
  INDEX `idx_rfe_triggered_at` (`triggered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ONBOARDING TASK TEMPLATES (admin-managed checklist library)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `onboarding_task_templates` (
  `id`                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `slug`               VARCHAR(100)  NOT NULL UNIQUE,
  `task_type`          ENUM('form','upload','sign_document') NOT NULL DEFAULT 'form',
  `title_en`           VARCHAR(255)  NOT NULL,
  `title_es`           VARCHAR(255)  NOT NULL,
  `description_en`     TEXT          DEFAULT NULL,
  `description_es`     TEXT          DEFAULT NULL,
  `content_html_en`    MEDIUMTEXT    DEFAULT NULL COMMENT 'sign_document EN body',
  `content_html_es`    MEDIUMTEXT    DEFAULT NULL COMMENT 'sign_document ES body',
  `form_fields_json`   JSON          DEFAULT NULL COMMENT 'array of field defs for form type',
  `upload_config_json` JSON          DEFAULT NULL COMMENT '{accept, max_mb} for upload type',
  `is_required`        TINYINT(1)    NOT NULL DEFAULT 1,
  `is_system`          TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'system tasks cannot be deleted',
  `sort_order`         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `is_active`          TINYINT(1)    NOT NULL DEFAULT 1,
  `auto_assign`        TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'Auto-assign to new clients on payment confirmation',
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ott_active_order` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- CLIENT TASK COMPLETIONS (per-case onboarding task progress)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_task_completions` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `client_id`        INT UNSIGNED  NOT NULL,
  `case_id`          INT UNSIGNED  NOT NULL,
  `task_template_id` INT UNSIGNED  NOT NULL,
  `status`           ENUM('pending','completed','skipped') NOT NULL DEFAULT 'pending',
  `form_data_json`   JSON          DEFAULT NULL,
  `file_storage_key` VARCHAR(500)  DEFAULT NULL,
  `file_name`        VARCHAR(255)  DEFAULT NULL,
  `file_mime`        VARCHAR(100)  DEFAULT NULL,
  `signature_name`   VARCHAR(150)  DEFAULT NULL,
  `signature_ip`     VARCHAR(45)   DEFAULT NULL,
  `completed_at`          DATETIME      DEFAULT NULL,
  `admin_review_status`   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `admin_notes`           TEXT          DEFAULT NULL,
  `admin_reviewed_at`     DATETIME      DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_case_task` (`case_id`, `task_template_id`),
  KEY `idx_ctc_client`        (`client_id`),
  KEY `idx_ctc_case`          (`case_id`),
  KEY `idx_ctc_template`      (`task_template_id`),
  KEY `idx_ctc_admin_review`  (`admin_review_status`),
  CONSTRAINT `fk_ctc_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctc_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctc_template`
    FOREIGN KEY (`task_template_id`) REFERENCES `onboarding_task_templates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SEED: Onboarding Task Templates
-- Applied by: 20260520_210000_seed_doc_templates_cleanup.sql
-- ============================================================================
INSERT INTO `onboarding_task_templates`
  (`id`, `slug`, `task_type`, `title_en`, `title_es`, `description_en`, `description_es`, `upload_config_json`, `is_required`, `is_system`, `sort_order`, `is_active`, `auto_assign`)
VALUES
  (664266, 'id_front',         'upload',        'Government ID — Front', 'ID Oficial — Frente',       'Front of your driver''s license or passport.', 'Frente de tu licencia de conducir o pasaporte.',          '{"accept":"image/*,application/pdf","max_mb":10}', 1, 1, 10, 1, 1),
  (664267, 'id_back',          'upload',        'Government ID — Back',  'ID Oficial — Reverso',      'Back of your photo ID.',                       'Reverso de tu identificación con foto.',                  '{"accept":"image/*,application/pdf","max_mb":10}', 1, 1, 20, 1, 1),
  (664268, 'ssn_card',         'upload',        'Social Security Card',  'Tarjeta de Seguro Social',  'Clear photo of your SSN card or a W-2.',       'Foto clara de tu tarjeta SSN o un W-2.',                  '{"accept":"image/*,application/pdf","max_mb":10}', 1, 1, 30, 1, 1),
  (664269, 'proof_of_address', 'upload',        'Proof of Address',      'Comprobante de Domicilio',  'Utility bill, lease, or bank statement.',      'Recibo de servicios, contrato o estado de cuenta.',       '{"accept":"image/*,application/pdf","max_mb":10}', 1, 1, 40, 1, 1),
  (1,      'service_agreement','sign_document', 'Service Agreement',     'Contrato de Servicios',     'Read and e-sign your service agreement.',      'Lee y firma electrónicamente tu contrato de servicios.',  NULL,                                              1, 1, 50, 1, 1)
ON DUPLICATE KEY UPDATE `sort_order` = VALUES(`sort_order`), `auto_assign` = VALUES(`auto_assign`);

-- ============================================================================
-- LEGAL DOCUMENTS (markdown bodies editable via admin Settings)
-- Applied by: 20260717_120000_legal_documents.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS `legal_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content_md` MEDIUMTEXT NOT NULL,
  `source_url` VARCHAR(500) DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_documents_slug` (`slug`),
  CONSTRAINT `fk_legal_documents_admin`
    FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
