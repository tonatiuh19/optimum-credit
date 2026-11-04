-- Credit Analysis review gate (Spec v2.1 §11 + Claude auditor). NULL = read
-- before the gate existed (treated as approved). A client result / email is
-- released only when review_status is passed or approved.
-- (TiDB: one column per statement when using AFTER.)
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `review_status` ENUM('pending','running','passed','needs_review','approved') DEFAULT NULL
    COMMENT 'Analysis review gate; NULL = legacy (approved)' AFTER `completed_at`;
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `review_findings_json` JSON DEFAULT NULL
    COMMENT '{selfCheck, audit[], reconciledAdded, error}' AFTER `review_status`;
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `review_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `review_findings_json`;
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `review_started_at` DATETIME DEFAULT NULL AFTER `review_attempts`;
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL AFTER `review_started_at`;
ALTER TABLE `credit_file_extractions`
  ADD COLUMN `reviewed_at` DATETIME DEFAULT NULL AFTER `reviewed_by_admin_id`;
ALTER TABLE `credit_file_extractions`
  ADD KEY `idx_cfe_review` (`review_status`, `completed_at`);
