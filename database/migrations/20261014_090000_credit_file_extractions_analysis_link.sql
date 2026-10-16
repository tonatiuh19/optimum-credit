-- Link enhanced extraction jobs to the existing Credit Analysis row so the
-- analysis "Download PDF" can serve the enhanced PDF when ready (additive).
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

ALTER TABLE `credit_file_extractions`
  ADD COLUMN `credit_analysis_id` INT UNSIGNED DEFAULT NULL AFTER `case_id`;

ALTER TABLE `credit_file_extractions`
  ADD KEY `idx_cfe_credit_analysis` (`credit_analysis_id`);
