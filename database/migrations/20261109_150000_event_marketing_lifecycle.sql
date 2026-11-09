-- Event marketing: lifecycle (waitlist, reminders, follow-up, self/door check-in,
-- paper-sheet import) + never-overwrite profile mismatch flag.
-- TiDB Cloud Serverless (MySQL 8.0 compatible). Additive only — no breaking changes.

ALTER TABLE `event_registrations`
  ADD COLUMN `status` ENUM('registered','waitlisted','cancelled') NOT NULL DEFAULT 'registered',
  ADD COLUMN `check_in_method` ENUM('staff','self','import') DEFAULT NULL,
  ADD COLUMN `profile_mismatch` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Typed name/phone differs from the existing CRM record (CRM kept as is)',
  ADD COLUMN `reminder_24h_sent_at` DATETIME DEFAULT NULL,
  ADD COLUMN `reminder_2h_sent_at` DATETIME DEFAULT NULL,
  ADD COLUMN `followup_sent_at` DATETIME DEFAULT NULL,
  ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `event_registrations`
  ADD UNIQUE KEY `uq_event_reg_session_client` (`session_id`, `client_id`),
  ADD KEY `idx_event_reg_session_status` (`session_id`, `status`);

ALTER TABLE `event_sessions`
  ADD COLUMN `checkin_token` VARCHAR(40) DEFAULT NULL
    COMMENT 'Secret for the door self check-in QR (/e/checkin/:token)';

ALTER TABLE `event_sessions`
  ADD UNIQUE KEY `uq_event_sessions_checkin_token` (`checkin_token`);
