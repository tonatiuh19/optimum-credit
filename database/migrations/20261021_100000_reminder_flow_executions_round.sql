-- Duplicate guard per round: rounds 6–12 share one flow (round_extended_complete),
-- so "same flow + client within 10 min" silently skipped Round 7+ when staff
-- published several rounds back-to-back. The guard now also matches the round.
ALTER TABLE `reminder_flow_executions`
  ADD COLUMN `round_number` TINYINT UNSIGNED DEFAULT NULL
    COMMENT 'Round this execution was for (progress-report flows); duplicate guard key'
    AFTER `client_id`;
