-- Nov 12, 2026: staff mark an AI-read account row as "not a real account" (a row read twice or a
-- partial row) on one pull + bureau. Applied every time that pull is used, so rebuilds keep it.
CREATE TABLE IF NOT EXISTS `credit_file_read_exclusions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `extraction_id` BIGINT UNSIGNED NOT NULL,
  `bureau` ENUM('TU','EX','EQ') NOT NULL,
  `creditor` VARCHAR(255) NOT NULL,
  `mask` VARCHAR(64) DEFAULT NULL,
  `balance` DECIMAL(12,2) DEFAULT NULL,
  `date_opened` VARCHAR(20) DEFAULT NULL,
  `round_report_id` INT UNSIGNED DEFAULT NULL COMMENT 'Report the staff member was looking at',
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `credit_file_read_exclusions` ADD KEY `idx_cfre_extraction` (`extraction_id`);

ALTER TABLE `credit_file_read_exclusions` ADD CONSTRAINT `fk_cfre_extraction` FOREIGN KEY (`extraction_id`) REFERENCES `credit_file_extractions`(`id`) ON DELETE CASCADE;
