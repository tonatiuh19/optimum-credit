-- OFG Progress Report: track where the "before" PDF came from (upload vs prior round reuse)
-- Split ALTERs for TiDB compatibility (cannot ADD KEY referencing a column in the same statement as ADD COLUMN).
ALTER TABLE `report_wizard_sessions`
  ADD COLUMN `before_source` ENUM('upload','prior_round','enrollment') NOT NULL DEFAULT 'upload'
    COMMENT 'How before PDF was obtained for this session'
    AFTER `before_pdf_id`;

ALTER TABLE `report_wizard_sessions`
  ADD COLUMN `before_reused_from_session_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Published session whose after PDF was reused as before'
    AFTER `before_source`;

ALTER TABLE `report_wizard_sessions`
  ADD KEY `idx_rws_before_reused` (`before_reused_from_session_id`);
