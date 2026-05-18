-- Migration: Credit Repair Cloud Integration
-- Date: 2026-05-12
-- Adds CRC (Credit Repair Cloud) tracking columns to clients table
-- and a crc_sync_log table for audit purposes.

-- 1. Add CRC tracking columns to clients (two separate ALTERs for TiDB compatibility)
ALTER TABLE `clients`
  ADD COLUMN `crc_client_id` VARCHAR(64) DEFAULT NULL COMMENT 'Base64-encoded CRC lead/client ID returned by CRC API' AFTER `status`;

ALTER TABLE `clients`
  ADD COLUMN `crc_synced_at` DATETIME DEFAULT NULL COMMENT 'Last successful sync timestamp with CRC API' AFTER `crc_client_id`;

CREATE INDEX `idx_clients_crc_id` ON `clients` (`crc_client_id`);

-- 2. CRC sync audit log
CREATE TABLE IF NOT EXISTS `crc_sync_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `action` ENUM('push_create','push_update','pull','webhook_stage_update') NOT NULL,
  `crc_client_id` VARCHAR(64) DEFAULT NULL,
  `pipeline_stage` VARCHAR(50) DEFAULT NULL,
  `status` ENUM('success','error') NOT NULL DEFAULT 'success',
  `error_message` TEXT DEFAULT NULL,
  `payload` JSON DEFAULT NULL COMMENT 'Request/response payload for debugging',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_crc_sync_client` (`client_id`),
  KEY `idx_crc_sync_action` (`action`),
  KEY `idx_crc_sync_created` (`created_at`),
  CONSTRAINT `fk_crc_sync_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
