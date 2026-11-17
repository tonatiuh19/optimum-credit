-- Nov 17, 2026: browser softphone failures were only shown on the staff member's screen (e.g. Twilio
-- 53405 when answering on a phone). Each error / busy-rejection is now recorded with the device context.
CREATE TABLE IF NOT EXISTS `voice_client_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `call_sid` VARCHAR(64) DEFAULT NULL,
  `direction` ENUM('incoming','outgoing','device') NOT NULL,
  `event` VARCHAR(40) NOT NULL COMMENT 'error | rejected_busy',
  `error_code` INT DEFAULT NULL COMMENT 'Twilio Voice SDK code, e.g. 53405',
  `error_message` VARCHAR(500) DEFAULT NULL,
  `seconds_since_answer` DECIMAL(8,2) DEFAULT NULL COMMENT 'Incoming: time between tapping answer and the error',
  `is_mobile` TINYINT(1) DEFAULT NULL,
  `platform` VARCHAR(40) DEFAULT NULL,
  `browser` VARCHAR(40) DEFAULT NULL,
  `network_type` VARCHAR(30) DEFAULT NULL COMMENT 'Network Information API when the browser exposes it (not Safari)',
  `visibility` VARCHAR(20) DEFAULT NULL COMMENT 'document.visibilityState when it happened',
  `online` TINYINT(1) DEFAULT NULL,
  `mic_permission` VARCHAR(20) DEFAULT NULL,
  `user_agent` VARCHAR(400) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `voice_client_events` ADD KEY `idx_vce_admin_created` (`admin_id`, `created_at`);

ALTER TABLE `voice_client_events` ADD KEY `idx_vce_call` (`call_sid`);
