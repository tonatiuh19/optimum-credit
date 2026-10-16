-- Credit Analysis v2 (Cesar spec, Oct 15 2026): agent-entered escrow flag and
-- the lender's own score (usually FICO) for the analysis PDF + goal text.
-- escrow_flag: NULL = auto-detect (mortgage pull in last 45 days), 1 = in
-- escrow (agent), 0 = not in escrow (agent override).
ALTER TABLE credit_analyses
  ADD COLUMN escrow_flag TINYINT(1) DEFAULT NULL
    COMMENT 'NULL auto-detect | 1 in escrow (agent) | 0 not in escrow',
  ADD COLUMN lender_score_model VARCHAR(40) DEFAULT NULL
    COMMENT 'Lender score model, e.g. FICO 2/4/5 (mortgage)',
  ADD COLUMN lender_score SMALLINT UNSIGNED DEFAULT NULL
    COMMENT 'Lender middle score (agent-entered)',
  ADD COLUMN lender_target_score SMALLINT UNSIGNED DEFAULT NULL
    COMMENT 'Score the lender needs';
