-- Add 'processing' status to notification_queue to support atomic cron batch claiming
-- This prevents duplicate sends when two cron runs overlap.

ALTER TABLE `notification_queue`
  MODIFY COLUMN `status`
    ENUM('pending','processing','sent','failed','cancelled')
    NOT NULL DEFAULT 'pending';
