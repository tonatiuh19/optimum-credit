-- Admin notification preferences + in-app inbox
-- Prefs: JSON on admins (null = all channels/events ON — matches legacy always-on behavior)
-- Inbox: admin_notifications for in-app bell delivery

ALTER TABLE `admins`
  ADD COLUMN `notification_prefs_json` JSON DEFAULT NULL
    COMMENT 'Per-admin channel×event toggles: { email|in_app|sms: { event_key: bool } }'
  AFTER `avatar_url`;

CREATE TABLE IF NOT EXISTS `admin_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `event_key` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT DEFAULT NULL,
  `link_url` VARCHAR(500) DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL,
  `read_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_notif_admin_created` (`admin_id`, `created_at`),
  KEY `idx_admin_notif_admin_unread` (`admin_id`, `read_at`),
  CONSTRAINT `fk_admin_notif_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
