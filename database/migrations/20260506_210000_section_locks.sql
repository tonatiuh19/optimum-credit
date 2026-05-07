-- ============================================================================
-- Migration: 20260506_210000_section_locks
-- Adds section_locks table for toggling admin panel sections on/off from the DB
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `section_locks` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `section_key`          VARCHAR(50)  NOT NULL UNIQUE
                           COMMENT 'Matches the nav route key, e.g. conversations',
  `label`                VARCHAR(100) NOT NULL
                           COMMENT 'Human-readable section name shown in settings UI',
  `is_locked`            TINYINT(1)   NOT NULL DEFAULT 0,
  `lock_reason`          VARCHAR(255) DEFAULT NULL
                           COMMENT 'Optional message shown to admins when section is locked',
  `updated_by_admin_id`  INT UNSIGNED DEFAULT NULL,
  `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_section_locks_key` (`section_key`),
  CONSTRAINT `fk_section_locks_admin`
    FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed all known nav sections (conversations locked by default)
INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`) VALUES
  ('dashboard',      'Dashboard',       0, NULL),
  ('clients',        'Clients',         0, NULL),
  ('pipeline',       'Pipeline',        0, NULL),
  ('documents',      'Doc Review',      0, NULL),
  ('payments',       'Payments',        0, NULL),
  ('conversations',  'Conversations',   1, 'Coming soon — messaging system is under construction.'),
  ('tickets',        'Support',         0, NULL),
  ('templates',      'Templates',       0, NULL),
  ('videos',         'Videos',          0, NULL),
  ('reminder-flows', 'Reminder Flows',  0, NULL),
  ('reports',        'Reports',         0, NULL),
  ('settings',       'Settings',        0, NULL),
  ('people',         'People',          0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
