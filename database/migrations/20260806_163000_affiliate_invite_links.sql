-- Staff-managed affiliate invite links (evergreen + one-time)
-- Public signup: /affiliate/join/:token → auto-comped basics

CREATE TABLE IF NOT EXISTS `affiliate_invite_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `kind` ENUM('evergreen','one_time') NOT NULL DEFAULT 'evergreen',
  `label` VARCHAR(120) DEFAULT NULL,
  `plan` ENUM('standard','master','sub_affiliate') NOT NULL DEFAULT 'standard',
  `parent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Required when plan=sub_affiliate — master parent',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `max_uses` INT UNSIGNED DEFAULT NULL
    COMMENT 'NULL = unlimited (evergreen); typically 1 for one_time',
  `use_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_invite_token` (`token`),
  KEY `idx_aff_invite_enabled` (`is_enabled`),
  KEY `idx_aff_invite_creator` (`created_by_admin_id`),
  KEY `idx_aff_invite_parent` (`parent_affiliate_id`),
  CONSTRAINT `fk_aff_invite_creator`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_invite_parent`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
