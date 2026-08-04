-- ============================================================================
-- Migration: 20260801_180000_aff_comm_payment_unique
-- Adds a DB-level backstop against double-paying affiliate commissions for
-- the same payment. Application code already guards on payment_id before
-- inserting, but this closes the race where two concurrent requests for the
-- same payment (e.g. retried webhook + direct pay) both pass that check
-- before either INSERT commits.
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- Idempotent: skips ADD UNIQUE when the index already exists.
-- ============================================================================

-- Dedupe any existing doubles keeping min(id)
DELETE ac1 FROM affiliate_commissions ac1
INNER JOIN affiliate_commissions ac2
  ON ac1.payment_id = ac2.payment_id AND ac1.kind = ac2.kind AND ac1.affiliate_id = ac2.affiliate_id
  AND ac1.id > ac2.id
WHERE ac1.payment_id IS NOT NULL;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'affiliate_commissions'
    AND INDEX_NAME = 'uq_aff_comm_payment_kind_aff'
);

SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE affiliate_commissions ADD UNIQUE KEY uq_aff_comm_payment_kind_aff (payment_id, kind, affiliate_id)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
