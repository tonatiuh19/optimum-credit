-- Case round-completion calendar schedule (expected dates for Rounds 1–5).
-- Used for optional iCal (.ics) invites to client, referrer, and assigned admin.

CREATE TABLE IF NOT EXISTS `case_round_schedules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` INT UNSIGNED NOT NULL,
  `round_1_date` DATE NOT NULL,
  `round_2_date` DATE NOT NULL,
  `round_3_date` DATE NOT NULL,
  `round_4_date` DATE NOT NULL,
  `round_5_date` DATE NOT NULL,
  `interval_days` INT UNSIGNED NOT NULL DEFAULT 35 COMMENT 'Days between rounds used when prefilling',
  `calendar_uid_ns` VARCHAR(64) NOT NULL COMMENT 'Stable ICS UID namespace for update invites',
  `last_sent_at` DATETIME DEFAULT NULL,
  `last_sent_recipients` JSON DEFAULT NULL COMMENT 'Array of email addresses last notified',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_case_round_schedules_case` (`case_id`),
  CONSTRAINT `fk_case_round_schedules_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
