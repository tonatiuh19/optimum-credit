-- Feature requests posted in the Slack #feature-requests channel and the
-- AI evaluation replied in-thread. One row per top-level Slack message.
CREATE TABLE IF NOT EXISTS `slack_feature_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slack_channel_id` VARCHAR(32) NOT NULL,
  `slack_ts` VARCHAR(32) NOT NULL COMMENT 'Slack message ts (thread root)',
  `slack_user_id` VARCHAR(32) DEFAULT NULL,
  `request_text` TEXT NOT NULL,
  `status` ENUM('new','evaluated','accepted','rejected','done','failed') NOT NULL DEFAULT 'new',
  `effort` ENUM('S','M','L') DEFAULT NULL,
  `evaluation_json` JSON DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `evaluated_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_slack_feature_request_msg` (`slack_channel_id`, `slack_ts`),
  KEY `idx_slack_feature_requests_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
