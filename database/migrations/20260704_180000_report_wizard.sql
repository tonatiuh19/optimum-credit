-- OFG Progress Report Wizard: sessions, source PDFs, extended round report fields

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

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `bureau_scores_json` JSON DEFAULT NULL AFTER `summary_md`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `wins_json` JSON DEFAULT NULL AFTER `bureau_scores_json`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `targets_json` JSON DEFAULT NULL AFTER `wins_json`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `utilization_json` JSON DEFAULT NULL AFTER `targets_json`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `action_plan_json` JSON DEFAULT NULL AFTER `utilization_json`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `file_strength_score` TINYINT UNSIGNED DEFAULT NULL AFTER `action_plan_json`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `wizard_session_id` INT UNSIGNED DEFAULT NULL AFTER `file_strength_score`;

ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `report_locale` ENUM('en','es') NOT NULL DEFAULT 'en' AFTER `wizard_session_id`;
