-- Conversations Contact Hub: OFG phone numbers, unknown inbound, schema for multi-number threads.
-- TiDB Cloud Serverless (MySQL 8.0 compatible)
-- Note: ALTER COLUMN adds are split — TiDB rejects AFTER <col> when that col is added in the same statement.

CREATE TABLE IF NOT EXISTS `admin_phone_numbers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `e164` VARCHAR(20) NOT NULL COMMENT 'E.164 e.g. +19497734127',
  `friendly_name` VARCHAR(120) DEFAULT NULL,
  `twilio_sid` VARCHAR(64) DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `capabilities_json` JSON DEFAULT NULL COMMENT '{"sms":true,"mms":true,"voice":true}',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_phone_e164` (`e164`),
  KEY `idx_admin_phone_assigned` (`assigned_admin_id`),
  CONSTRAINT `fk_admin_phone_admin` FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_unknown_contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone_e164` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `display_name` VARCHAR(200) DEFAULT NULL,
  `ofg_number_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('open','linked','dismissed') NOT NULL DEFAULT 'open',
  `linked_client_id` INT UNSIGNED DEFAULT NULL,
  `last_message_at` DATETIME DEFAULT NULL,
  `last_message_preview` VARCHAR(500) DEFAULT NULL,
  `unread_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_unknown_phone` (`phone_e164`),
  KEY `idx_unknown_status` (`status`),
  KEY `idx_unknown_number` (`ofg_number_id`),
  CONSTRAINT `fk_unknown_ofg_number` FOREIGN KEY (`ofg_number_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_unknown_linked_client` FOREIGN KEY (`linked_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Allow client_id NULL for unknown-only threads; expand status for snooze
ALTER TABLE `conversations`
  MODIFY COLUMN `client_id` INT UNSIGNED NULL,
  MODIFY COLUMN `status` ENUM('open','snoozed','closed','archived') NOT NULL DEFAULT 'open';

-- Add OFG number + unknown FK columns (separate statements for TiDB)
-- Idempotent-ish: ignore duplicate column errors by checking information_schema in ops notes;
-- fresh apply expects these columns absent.
ALTER TABLE `conversations`
  ADD COLUMN `ofg_number_id` INT UNSIGNED DEFAULT NULL AFTER `assigned_admin_id`;

ALTER TABLE `conversations`
  ADD COLUMN `unknown_contact_id` INT UNSIGNED DEFAULT NULL AFTER `ofg_number_id`;

ALTER TABLE `conversations`
  ADD KEY `idx_conversations_ofg_number` (`ofg_number_id`),
  ADD KEY `idx_conversations_unknown` (`unknown_contact_id`);

ALTER TABLE `conversations`
  ADD CONSTRAINT `fk_conversations_ofg_number`
    FOREIGN KEY (`ofg_number_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_conversations_unknown`
    FOREIGN KEY (`unknown_contact_id`) REFERENCES `conversation_unknown_contacts`(`id`) ON DELETE SET NULL;

-- Seed Cesar's first inventory number (unassigned until a super_admin assigns it in People/UI)
INSERT INTO `admin_phone_numbers` (`e164`, `friendly_name`, `capabilities_json`, `is_active`)
VALUES (
  '+19497734127',
  'Cesar OFG — Newport Beach',
  JSON_OBJECT('sms', TRUE, 'mms', TRUE, 'voice', TRUE),
  1
)
ON DUPLICATE KEY UPDATE
  `friendly_name` = VALUES(`friendly_name`),
  `capabilities_json` = VALUES(`capabilities_json`),
  `is_active` = 1;

-- Unlock Conversations section; access is gated by assigned OFG number (API + nav).
UPDATE `section_locks`
SET `is_locked` = 0, `lock_reason` = NULL
WHERE `section_key` = 'conversations';
