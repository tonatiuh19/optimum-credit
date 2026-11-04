-- Progress Report Engine Spec v1 (Oct 22 2026):
--  * file hashes on reads (PR-P0-5 data-integrity block)
--  * per-round write-back (§9): report dates, hashes, engine output
--  * items_disputed from the dispute log only — NULL = "not recorded" (PR-P0-8)
ALTER TABLE credit_file_extractions ADD COLUMN `file_sha256` CHAR(64) DEFAULT NULL COMMENT 'SHA-256 of the uploaded file (identical-pull guard)';
ALTER TABLE client_round_reports ADD COLUMN `before_report_date` VARCHAR(20) DEFAULT NULL COMMENT 'Report Date of the Before pull (never the filename)';
ALTER TABLE client_round_reports ADD COLUMN `after_report_date` VARCHAR(20) DEFAULT NULL COMMENT 'Report Date of the After pull';
ALTER TABLE client_round_reports ADD COLUMN `before_file_hash` CHAR(64) DEFAULT NULL;
ALTER TABLE client_round_reports ADD COLUMN `after_file_hash` CHAR(64) DEFAULT NULL;
ALTER TABLE client_round_reports ADD COLUMN `engine_json` JSON DEFAULT NULL COMMENT 'Engine write-back: per-bureau diff, attribution, flags, File Strength components';
ALTER TABLE client_round_reports MODIFY COLUMN `items_disputed` INT UNSIGNED DEFAULT NULL COMMENT 'From the dispute log; NULL = not recorded';
