-- Bulk CSV import staging jobs (admin client import)

CREATE TABLE IF NOT EXISTS `bulk_import_jobs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity` ENUM('clients') NOT NULL DEFAULT 'clients',
  `uploaded_by_admin_id` INT UNSIGNED NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_sha256` CHAR(64) NOT NULL,
  `status` ENUM('validated','processing','committed','expired','failed') NOT NULL DEFAULT 'validated',
  `options_json` JSON DEFAULT NULL,
  `preview_json` JSON DEFAULT NULL,
  `result_json` JSON DEFAULT NULL,
  `row_count` INT NOT NULL DEFAULT 0,
  `created_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `error_count` INT NOT NULL DEFAULT 0,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `committed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bulk_import_status` (`status`),
  KEY `idx_bulk_import_uploader` (`uploaded_by_admin_id`, `created_at`),
  CONSTRAINT `fk_bulk_import_admin` FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
