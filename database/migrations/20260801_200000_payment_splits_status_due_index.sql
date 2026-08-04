-- ============================================================================
-- Migration: 20260801_200000_payment_splits_status_due_index
-- Composite index for overdue sweeps (status + due_date).
-- Idempotent: skips ADD KEY when the index already exists.
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payment_splits'
    AND INDEX_NAME = 'idx_splits_status_due'
);

SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE payment_splits ADD KEY idx_splits_status_due (status, due_date)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
