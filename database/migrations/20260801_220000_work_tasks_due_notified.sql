-- ============================================================================
-- Migration: 20260801_220000_work_tasks_due_notified
-- Tracks overdue/due email reminders for admin Work Hub tasks.
-- Idempotent ADD COLUMN.
-- ============================================================================

ALTER TABLE `admin_work_tasks`
  ADD COLUMN IF NOT EXISTS `due_notified_at` DATETIME DEFAULT NULL
    COMMENT 'Last overdue/due reminder email sent to assignee'
    AFTER `pending_push`;
