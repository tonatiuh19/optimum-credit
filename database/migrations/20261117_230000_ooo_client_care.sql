-- Nov 17, 2026 (Cesar): out-of-office periods per staff member (backups by language, return date) and
-- client care tracking — every client text / missed call posted to Slack #client-care, ✅ when answered,
-- reminder after 2 business hours, escalation after 4.
CREATE TABLE IF NOT EXISTS `admin_out_of_office` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `starts_on` DATE NOT NULL COMMENT 'First day away (Pacific)',
  `returns_on` DATE NOT NULL COMMENT 'First day back (Pacific)',
  `backup_en_admin_id` INT UNSIGNED DEFAULT NULL,
  `backup_es_admin_id` INT UNSIGNED DEFAULT NULL,
  `note_en` VARCHAR(200) DEFAULT NULL COMMENT 'Optional, e.g. "I am in Mexico"',
  `note_es` VARCHAR(200) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `admin_out_of_office` ADD KEY `idx_ooo_admin_dates` (`admin_id`, `starts_on`, `returns_on`);

CREATE TABLE IF NOT EXISTS `client_care_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `contact_id` INT UNSIGNED DEFAULT NULL,
  `unknown_contact_id` INT UNSIGNED DEFAULT NULL,
  `channel` ENUM('sms','call') NOT NULL DEFAULT 'sms',
  `lang` ENUM('en','es') NOT NULL DEFAULT 'en',
  `owner_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Who answers (language owner, or their backup when out of office)',
  `line_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Owner of the OFG line the client used',
  `display_name` VARCHAR(200) DEFAULT NULL,
  `last_text` VARCHAR(600) DEFAULT NULL,
  `topic` VARCHAR(120) DEFAULT NULL,
  `message_count` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `status` ENUM('open','done') NOT NULL DEFAULT 'open',
  `done_how` VARCHAR(30) DEFAULT NULL COMMENT 'ofg_reply | ai_answered | slack_check',
  `done_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `slack_channel` VARCHAR(40) DEFAULT NULL,
  `slack_ts` VARCHAR(40) DEFAULT NULL,
  `auto_reply_at` DATETIME DEFAULT NULL,
  `reminded_at` DATETIME DEFAULT NULL,
  `escalated_at` DATETIME DEFAULT NULL,
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `client_care_items` ADD KEY `idx_cci_conversation_status` (`conversation_id`, `status`);

ALTER TABLE `client_care_items` ADD KEY `idx_cci_status_opened` (`status`, `opened_at`);
