-- Staged Before PDFs for OFG report wizard sequential uploads.
-- Vercel serverless body limit (~4.5 MB) cannot accept two Ultra credit-report
-- PDFs in one multipart request; client uploads Before first, then After + staged id.
CREATE TABLE IF NOT EXISTS `report_wizard_staged_pdfs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `storage_key` VARCHAR(500) NOT NULL,
  `storage_provider` ENUM('local','cdn') NOT NULL DEFAULT 'cdn',
  `encrypted` TINYINT(1) NOT NULL DEFAULT 1,
  `enc_iv` CHAR(32) NOT NULL,
  `enc_tag` CHAR(32) NOT NULL,
  `byte_size` INT UNSIGNED NOT NULL,
  `uploaded_by_admin_id` INT UNSIGNED NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rwsp_case` (`case_id`),
  KEY `idx_rwsp_admin` (`uploaded_by_admin_id`),
  KEY `idx_rwsp_expires` (`expires_at`),
  CONSTRAINT `fk_rwsp_case` FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rwsp_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rwsp_admin` FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
