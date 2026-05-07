-- ============================================================================
-- Migration: 20260506_220000_section_locks_backfill
-- Adds missing section_locks rows: dashboard, clients, pipeline, payments, settings
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`) VALUES
  ('dashboard', 'Dashboard', 0, NULL),
  ('clients',   'Clients',   0, NULL),
  ('pipeline',  'Pipeline',  0, NULL),
  ('payments',  'Payments',  0, NULL),
  ('settings',  'Settings',  0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
