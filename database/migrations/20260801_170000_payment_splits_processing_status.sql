-- ============================================================================
-- Migration: 20260801_170000_payment_splits_processing_status
-- Adds 'processing' to payment_splits.status so POST /api/pay/:token can
-- atomically reserve a split (pending -> processing) BEFORE charging the
-- card, closing a race where two concurrent submits of the same link could
-- both charge (the reservation UPDATE ... WHERE status='pending' only
-- succeeds for one of them once 'processing' is a valid intermediate state).
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

ALTER TABLE `payment_splits`
  MODIFY COLUMN `status` ENUM('pending','processing','paid','overdue','cancelled')
    NOT NULL DEFAULT 'pending';
