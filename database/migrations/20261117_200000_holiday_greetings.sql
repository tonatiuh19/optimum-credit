-- Nov 17, 2026 (Cesar): holiday greetings — one approved SMS per holiday per year to current clients,
-- from each client's own OFG line, EN/ES, optional image. Nothing sends without approval.
CREATE TABLE IF NOT EXISTS `holiday_greetings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `holiday_key` VARCHAR(32) NOT NULL COMMENT 'thanksgiving | christmas | new_year | independence_day | mothers_day | fathers_day | valentines',
  `year` SMALLINT UNSIGNED NOT NULL,
  `send_at` DATETIME NOT NULL COMMENT 'Wall time America/Los_Angeles',
  `status` ENUM('draft','approved','sending','sent','skipped','cancelled') NOT NULL DEFAULT 'draft',
  `body_en` TEXT NOT NULL,
  `body_es` TEXT NOT NULL,
  `media_url` VARCHAR(1000) DEFAULT NULL,
  `media_content_type` VARCHAR(120) DEFAULT NULL,
  `audience_json` JSON DEFAULT NULL COMMENT 'Client statuses + recent-texter window used to pick recipients',
  `approved_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `stats_json` JSON DEFAULT NULL COMMENT 'queued / sent / failed / skipped counts',
  `reminders_json` JSON DEFAULT NULL COMMENT 'Approval reminders already sent (7d / 2d / skipped)',
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `holiday_greetings` ADD UNIQUE KEY `uq_holiday_year` (`holiday_key`, `year`);

ALTER TABLE `holiday_greetings` ADD KEY `idx_hg_status_send` (`status`, `send_at`);

CREATE TABLE IF NOT EXISTS `holiday_greeting_recipients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `greeting_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `lang` ENUM('en','es') NOT NULL DEFAULT 'en',
  `sender_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Client owner whose OFG line sends it',
  `status` ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  `skip_reason` VARCHAR(80) DEFAULT NULL,
  `conversation_id` INT UNSIGNED DEFAULT NULL,
  `message_id` INT UNSIGNED DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `holiday_greeting_recipients` ADD UNIQUE KEY `uq_hgr_greeting_client` (`greeting_id`, `client_id`);

ALTER TABLE `holiday_greeting_recipients` ADD KEY `idx_hgr_status` (`greeting_id`, `status`);

ALTER TABLE `holiday_greeting_recipients` ADD KEY `idx_hgr_conversation` (`conversation_id`, `sent_at`);

ALTER TABLE `holiday_greeting_recipients` ADD CONSTRAINT `fk_hgr_greeting` FOREIGN KEY (`greeting_id`) REFERENCES `holiday_greetings`(`id`) ON DELETE CASCADE;

-- Numbers that texted STOP (TCPA). START removes. Every bulk / automated SMS skips them.
CREATE TABLE IF NOT EXISTS `sms_opt_outs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone_last10` CHAR(10) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `keyword` VARCHAR(20) DEFAULT NULL,
  `source` VARCHAR(40) NOT NULL DEFAULT 'inbound_keyword',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `sms_opt_outs` ADD UNIQUE KEY `uq_sms_opt_out_last10` (`phone_last10`);

-- Backfill: every number whose latest STOP / START keyword is a STOP.
INSERT IGNORE INTO `sms_opt_outs` (`phone_last10`, `phone`, `keyword`, `source`, `created_at`)
SELECT RIGHT(REGEXP_REPLACE(m.from_address, '[^0-9]', ''), 10), m.from_address, UPPER(TRIM(m.body)), 'backfill', m.created_at
FROM conversation_messages m
WHERE m.direction = 'inbound'
  AND m.from_address IS NOT NULL
  AND UPPER(TRIM(m.body)) IN ('STOP','STOPALL','UNSUBSCRIBE','END','QUIT','CANCELAR','BAJA')
  AND NOT EXISTS (
    SELECT 1 FROM conversation_messages s
    WHERE s.direction = 'inbound' AND s.from_address = m.from_address AND s.created_at > m.created_at
      AND UPPER(TRIM(s.body)) IN ('START','YES','UNSTOP')
  );
