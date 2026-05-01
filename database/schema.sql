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
  `duration_months` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `features_json` JSON DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_packages_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `packages` (`slug`,`name`,`subtitle`,`description`,`price_cents`,`duration_months`,`features_json`,`sort_order`) VALUES
  ('standard','Standard Repair','For First-Time Filers','Perfect for those new to credit repair with a few negative items.',59900,5,
   JSON_ARRAY('Credit report analysis','Up to 10 dispute letters','Monthly progress reports','Email support','Client portal access'),1),
  ('complex','Complex Repair','Most Popular','Comprehensive repair for multiple negative items and complex situations.',89900,5,
   JSON_ARRAY('Everything in Standard','Unlimited dispute letters','Bi-weekly progress updates','Phone & email support','Specialized negotiation','Collections handling'),2),
  ('tradeline','Tradeline','Maximum Results','Premium service with authorized user accounts to boost your score.',129900,5,
   JSON_ARRAY('Everything in Complex','Authorized user tradelines','Weekly priority calls','Personal credit coach','Hardship negotiations','Bankruptcy assistance'),3)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

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
  -- Status
  `status` ENUM('pending_payment','onboarding','active','paused','cancelled') NOT NULL DEFAULT 'pending_payment',
  `email_verified_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_clients_status` (`status`),
  KEY `idx_clients_pipeline_stage` (`pipeline_stage`),
  KEY `idx_clients_package` (`package_id`),
  KEY `idx_clients_affiliate` (`affiliate_id`),
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
-- PAYMENTS / STRIPE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `package_id` INT UNSIGNED DEFAULT NULL,
  `amount_cents` INT UNSIGNED NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'USD',
  `status` ENUM('pending','succeeded','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
  `provider` ENUM('stripe','manual') NOT NULL DEFAULT 'stripe',
  `stripe_payment_intent_id` VARCHAR(255) DEFAULT NULL UNIQUE,
  `stripe_charge_id` VARCHAR(255) DEFAULT NULL,
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
  CONSTRAINT `fk_payments_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- DOCUMENTS (ID, SSN card, proof of address)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `client_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `doc_type` ENUM('id_front','id_back','ssn_card','proof_of_address','other') NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `storage_provider` ENUM('local','s3','r2') NOT NULL DEFAULT 'local',
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
  KEY `idx_client_docs_status` (`review_status`),
  KEY `idx_client_docs_type` (`doc_type`),
  CONSTRAINT `fk_client_docs_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_docs_admin` FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
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
  `round_number` TINYINT UNSIGNED NOT NULL,
  `score_before` SMALLINT UNSIGNED DEFAULT NULL,
  `score_after` SMALLINT UNSIGNED DEFAULT NULL,
  `items_removed` INT UNSIGNED NOT NULL DEFAULT 0,
  `items_disputed` INT UNSIGNED NOT NULL DEFAULT 0,
  `summary_md` MEDIUMTEXT DEFAULT NULL,
  `pdf_storage_key` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `delivered_via_sms` TINYINT(1) NOT NULL DEFAULT 0,
  `delivered_via_email` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_round` (`client_id`,`round_number`),
  KEY `idx_round_reports_client` (`client_id`),
  CONSTRAINT `fk_round_reports_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_round_reports_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
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
-- CONVERSATIONS (Twilio SMS / Calls + Email via Resend)
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
  `description` TEXT DEFAULT NULL,
  `video_url` VARCHAR(500) NOT NULL,
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
  KEY `idx_videos_category` (`category`)
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
  ('email_round_complete','Round Complete Email','email','Your Round {{round_number}} report is ready','<h1>Round {{round_number}} Complete</h1><p>{{first_name}}, see your latest progress in your client portal.</p>', JSON_ARRAY('first_name','round_number'))
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
  `status` ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
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
