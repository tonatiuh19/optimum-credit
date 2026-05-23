-- ============================================================================
-- Migration: 20260520_200000_task_completions_admin_review
-- Adds admin review status to client_task_completions
-- Compatible with TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

ALTER TABLE `client_task_completions`
  ADD COLUMN `admin_review_status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE `client_task_completions`
  ADD COLUMN `admin_notes` TEXT DEFAULT NULL;

ALTER TABLE `client_task_completions`
  ADD COLUMN `admin_reviewed_at` DATETIME DEFAULT NULL;

ALTER TABLE `client_task_completions`
  ADD KEY `idx_ctc_admin_review` (`admin_review_status`);
