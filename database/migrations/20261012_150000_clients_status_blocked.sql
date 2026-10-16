-- Add 'blocked' client status: stops all automated client messaging (flows,
-- queue reminders, payment nudges, reminder SMS) and blocks portal login.
-- 'paused' also stops automations (enforced in code). Additive enum change only.
-- TiDB Cloud Serverless (MySQL 8.0 compatible).

ALTER TABLE `clients`
  MODIFY COLUMN `status` ENUM('prospect','funding','pending_payment','onboarding','active','paused','blocked','cancelled') NOT NULL DEFAULT 'pending_payment';
