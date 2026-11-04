-- Credit report read speed (Oct 27, 2026): reuse identical files, split large reads,
-- and record how each read ran. Additive, nullable columns only — older code ignores them.
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

ALTER TABLE `credit_file_extractions`
  ADD COLUMN `extract_version` VARCHAR(24) DEFAULT NULL COMMENT 'Reader prompt/schema/model fingerprint; same file + same version = reusable read',
  ADD COLUMN `read_mode` VARCHAR(16) DEFAULT NULL COMMENT 'direct | chunked | batch | reused',
  ADD COLUMN `read_parts` TINYINT UNSIGNED DEFAULT NULL COMMENT 'Page ranges read in parallel (chunked)',
  ADD COLUMN `read_ms` INT UNSIGNED DEFAULT NULL COMMENT 'Model time for the read (ms)',
  ADD COLUMN `output_tokens` INT UNSIGNED DEFAULT NULL COMMENT 'Model output tokens (sum of parts)',
  ADD COLUMN `reused_from_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'Ready read this row was copied from (same file)';

ALTER TABLE `credit_file_extractions`
  ADD INDEX `idx_cfe_reuse` (`file_sha256`, `extract_version`, `status`);
