-- Extended dispute rounds for special clients (report slots beyond Round 5).
-- Pipeline stage stays on round_5 while publishing rounds 6..max_rounds.

ALTER TABLE `credit_repair_cases`
  ADD COLUMN `max_rounds` TINYINT UNSIGNED NOT NULL DEFAULT 5
    COMMENT 'Max OFG progress rounds (5 default; staff may raise up to 12)'
    AFTER `pipeline_stage`;

ALTER TABLE `credit_repair_cases`
  ADD COLUMN `next_dispute_target_date` DATE DEFAULT NULL
    COMMENT 'Optional next dispute target for extended rounds (calendar)'
    AFTER `max_rounds`;
