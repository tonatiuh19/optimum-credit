-- Extended OFG programs: absolute max raised 12 → 24 (app constant ABSOLUTE_MAX_ROUNDS).
-- Active cases already at the old ceiling (12) move to 24 so nobody is auto-
-- completed at Round 12 by surprise (Lecca, Oct 23 2026). Idempotent.
UPDATE credit_repair_cases SET max_rounds = 24 WHERE status = 'active' AND max_rounds = 12;
ALTER TABLE credit_repair_cases MODIFY COLUMN `max_rounds` TINYINT UNSIGNED NOT NULL DEFAULT 5
  COMMENT 'Max OFG progress rounds (5 default; staff may raise up to 24)';
