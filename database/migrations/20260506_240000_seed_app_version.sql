-- Seed app_version into system_settings
-- This row is updated automatically by scripts/deploy-prod.ts on each production deploy.

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES ('app_version', NULL, 'Current deployed application version shown in the admin settings page.')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`);
