-- Prospect traffic light (semáforo): hot / warm / cold on prospects and web
-- leads only (active clients keep their own statuses). Recomputed by the
-- platform from conversation activity, analysis and registration signals.
-- TiDB Cloud Serverless (MySQL 8.0 compatible). Additive only.

ALTER TABLE `clients`
  ADD COLUMN `lead_temperature` ENUM('hot','warm','cold') DEFAULT NULL COMMENT 'Prospect traffic light; NULL for non-prospects';
ALTER TABLE `clients`
  ADD COLUMN `lead_temperature_reasons` VARCHAR(500) DEFAULT NULL COMMENT 'Comma-separated reason codes';
ALTER TABLE `clients`
  ADD COLUMN `lead_temperature_at` DATETIME DEFAULT NULL COMMENT 'When the color last changed';
ALTER TABLE `clients`
  ADD COLUMN `analysis_reviewed_at` DATETIME DEFAULT NULL COMMENT 'Credit analysis reviewed with the prospect (button or 5+ min call)';
ALTER TABLE `clients`
  ADD COLUMN `analysis_reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL;
ALTER TABLE `clients`
  ADD COLUMN `call_scheduled_at` DATETIME DEFAULT NULL COMMENT 'Next scheduled call with the prospect';
ALTER TABLE `clients`
  ADD COLUMN `lead_hot_stale_alerted_at` DATETIME DEFAULT NULL COMMENT 'Last 3-days-no-movement alert to Cesar';
ALTER TABLE `clients`
  ADD COLUMN `lead_convert_suggested_at` DATETIME DEFAULT NULL COMMENT 'Ready-to-convert suggestion sent';
ALTER TABLE `clients`
  ADD KEY `idx_clients_lead_temperature` (`lead_temperature`);
