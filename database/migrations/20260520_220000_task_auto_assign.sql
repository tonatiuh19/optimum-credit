-- ============================================================================
-- Migration: add auto_assign column to onboarding_task_templates
-- Date: 2026-05-20
-- Adds a flag that controls whether a task is automatically assigned to a
-- client when their payment is confirmed (markPaymentSucceeded).
-- ============================================================================

ALTER TABLE `onboarding_task_templates`
  ADD COLUMN `auto_assign` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Auto-assign to new clients on payment confirmation'
    AFTER `is_active`;

-- Back-fill all existing templates to auto_assign = 1
UPDATE `onboarding_task_templates` SET `auto_assign` = 1;
