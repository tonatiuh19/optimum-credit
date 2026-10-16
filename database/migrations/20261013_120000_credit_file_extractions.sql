-- Credit file extraction jobs (shared engine for Credit Analysis + Progress
-- Report). New uploads only: any provider, PDF or image. Claude reads the file
-- via Message Batches from the queue cron (runs > 60s Vercel limit).
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

CREATE TABLE IF NOT EXISTS `credit_file_extractions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `case_id` INT UNSIGNED DEFAULT NULL,
  `purpose` ENUM('analysis','progress_before','progress_after','other') NOT NULL DEFAULT 'other',
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL,
  `storage_key` VARCHAR(1000) NOT NULL COMMENT 'Encrypted file on CDN',
  `enc_iv` CHAR(32) NOT NULL,
  `enc_tag` CHAR(32) NOT NULL,
  `provider` VARCHAR(40) NOT NULL DEFAULT 'unknown' COMMENT 'smartcredit | equifax_3b | unknown (any provider is accepted)',
  `status` ENUM('queued','submitted','ready','failed') NOT NULL DEFAULT 'queued',
  `model` VARCHAR(80) DEFAULT NULL,
  `batch_id` VARCHAR(100) DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `text_skeleton_json` JSON DEFAULT NULL COMMENT 'Text-parser cross-check (recognized formats only)',
  `extracted_json` JSON DEFAULT NULL COMMENT 'CreditFile from Claude',
  `issues_json` JSON DEFAULT NULL COMMENT 'Cross-check issues for staff review',
  `confidence` DECIMAL(4,2) DEFAULT NULL,
  `image_pages` SMALLINT UNSIGNED DEFAULT NULL,
  `total_pages` SMALLINT UNSIGNED DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `submitted_at` DATETIME DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cfe_status` (`status`, `created_at`),
  KEY `idx_cfe_client` (`client_id`),
  KEY `idx_cfe_case` (`case_id`),
  KEY `idx_cfe_batch` (`batch_id`),
  CONSTRAINT `fk_cfe_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cfe_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cfe_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
