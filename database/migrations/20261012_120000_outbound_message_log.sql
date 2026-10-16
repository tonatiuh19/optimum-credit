-- Outbound message log: opt-in record of staff/system sends (progress-report
-- emails to clients and partners, MCP send_email, round-report SMS) so Claude
-- (Admin Ask MCP) can read what was sent and its delivery status without a
-- client_id. Auth/OTP/magic-link emails are never logged.
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

CREATE TABLE IF NOT EXISTS `outbound_message_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` ENUM('sms','email','whatsapp') NOT NULL,
  `recipient_type` ENUM('client','partner','admin','contact','other') NOT NULL DEFAULT 'client',
  `kind` VARCHAR(64) NOT NULL COMMENT 'e.g. round_report, staff_email',
  `client_id` INT UNSIGNED DEFAULT NULL,
  `case_id` INT UNSIGNED DEFAULT NULL,
  `round_number` TINYINT UNSIGNED DEFAULT NULL,
  `to_address` VARCHAR(255) NOT NULL,
  `from_address` VARCHAR(255) DEFAULT NULL,
  `subject` VARCHAR(255) DEFAULT NULL,
  `body_preview` VARCHAR(1000) DEFAULT NULL,
  `provider_message_id` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'sent' COMMENT 'sent | failed (SMS delivery status lives on conversation_messages)',
  `error_message` VARCHAR(500) DEFAULT NULL,
  `conversation_message_id` INT UNSIGNED DEFAULT NULL COMMENT 'SMS: thread row carrying live delivery status',
  `sent_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_outbound_log_created` (`created_at`),
  KEY `idx_outbound_log_client_kind` (`client_id`, `kind`, `round_number`),
  KEY `idx_outbound_log_channel` (`channel`, `created_at`),
  CONSTRAINT `fk_outbound_log_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_outbound_log_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_outbound_log_admin` FOREIGN KEY (`sent_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
