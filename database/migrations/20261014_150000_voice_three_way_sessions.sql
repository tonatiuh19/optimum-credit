-- Three-way calls (staff + client + third party such as SmartCredit / MFSN)
-- via Twilio Conference. A session is created only when staff press
-- "Add caller" during a live call; normal calls are unchanged.
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

CREATE TABLE IF NOT EXISTS `voice_three_way_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conference_name` VARCHAR(80) NOT NULL,
  `conference_sid` VARCHAR(64) DEFAULT NULL,
  `direction` ENUM('inbound','outbound') NOT NULL,
  `staff_call_sid` VARCHAR(64) NOT NULL COMMENT 'Browser softphone leg',
  `customer_call_sid` VARCHAR(64) NOT NULL COMMENT 'Client PSTN leg',
  `log_call_sid` VARCHAR(64) DEFAULT NULL COMMENT 'CallSid of the existing conversation call row',
  `admin_id` INT UNSIGNED NOT NULL,
  `from_e164` VARCHAR(20) NOT NULL COMMENT 'OFG line used as caller ID',
  `third_party_label` VARCHAR(80) DEFAULT NULL,
  `third_party_number` VARCHAR(20) NOT NULL,
  `third_party_call_sid` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('moving','active','ended','failed') NOT NULL DEFAULT 'moving',
  `error_message` VARCHAR(500) DEFAULT NULL,
  `recording_message_id` INT UNSIGNED DEFAULT NULL COMMENT 'conversation_messages row for the conference recording',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_3way_conference` (`conference_name`),
  KEY `idx_3way_staff_call` (`staff_call_sid`),
  KEY `idx_3way_customer_call` (`customer_call_sid`),
  KEY `idx_3way_conference_sid` (`conference_sid`),
  CONSTRAINT `fk_3way_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
