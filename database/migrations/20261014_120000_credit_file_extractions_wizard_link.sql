-- Link enhanced extraction jobs to a Progress Report Wizard session (Before /
-- After uploads) so Preview/Publish can append the enhanced pages when both
-- reads are ready (additive; today's PDF is unchanged otherwise).
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

ALTER TABLE `credit_file_extractions`
  ADD COLUMN `report_wizard_session_id` INT UNSIGNED DEFAULT NULL AFTER `credit_analysis_id`;

ALTER TABLE `credit_file_extractions`
  ADD KEY `idx_cfe_wizard_session` (`report_wizard_session_id`);
