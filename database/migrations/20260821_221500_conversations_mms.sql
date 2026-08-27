-- MMS media for Conversations (Twilio mediaUrl must be publicly fetchable with correct Content-Type).
-- Primary store: mms_media BLOB + public GET (same pattern as Encore/real-state).
-- Optional archival copy via DisruptingLabs uploadFiles.php / uploadMMS.php.

CREATE TABLE IF NOT EXISTS `mms_media` (
  `id` CHAR(36) NOT NULL,
  `content_type` VARCHAR(120) NOT NULL,
  `filename` VARCHAR(255) DEFAULT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `cdn_url` VARCHAR(1000) DEFAULT NULL COMMENT 'Optional DisruptingLabs archival URL',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mms_media_expires` (`expires_at`),
  CONSTRAINT `fk_mms_media_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TiDB: do not reference a column added in the same ALTER via AFTER.
ALTER TABLE `conversation_messages`
  ADD COLUMN `media_url` VARCHAR(1000) DEFAULT NULL AFTER `body`;

ALTER TABLE `conversation_messages`
  ADD COLUMN `media_content_type` VARCHAR(120) DEFAULT NULL AFTER `media_url`;
