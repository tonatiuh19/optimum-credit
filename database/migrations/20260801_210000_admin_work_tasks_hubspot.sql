-- ============================================================================
-- Migration: 20260801_210000_admin_work_tasks_hubspot
-- Admin Work Hub (My Tasks Kanban) + per-admin HubSpot OAuth + extract permissions.
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `admin_work_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `status` ENUM('backlog','doing','done') NOT NULL DEFAULT 'backlog',
  `priority` ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `due_at` DATETIME DEFAULT NULL,
  `labels_json` JSON DEFAULT NULL,
  `source` ENUM('optimum','hubspot') NOT NULL DEFAULT 'optimum',
  `hubspot_task_id` VARCHAR(64) DEFAULT NULL,
  `hubspot_owner_id` VARCHAR(64) DEFAULT NULL,
  `assignee_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `last_synced_at` DATETIME DEFAULT NULL,
  `sync_error` VARCHAR(500) DEFAULT NULL,
  `pending_push` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_work_tasks_hubspot` (`hubspot_task_id`),
  KEY `idx_work_tasks_status` (`status`),
  KEY `idx_work_tasks_assignee` (`assignee_admin_id`),
  KEY `idx_work_tasks_due` (`due_at`),
  KEY `idx_work_tasks_source` (`source`),
  CONSTRAINT `fk_work_tasks_assignee`
    FOREIGN KEY (`assignee_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_work_tasks_creator`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_hubspot_connections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `hub_id` VARCHAR(64) DEFAULT NULL,
  `hub_domain` VARCHAR(255) DEFAULT NULL,
  `token_ciphertext` MEDIUMBLOB NOT NULL,
  `token_iv` VARCHAR(64) NOT NULL,
  `token_tag` VARCHAR(64) NOT NULL,
  `scopes` TEXT DEFAULT NULL,
  `connected_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hubspot_conn_admin` (`admin_id`),
  CONSTRAINT `fk_hubspot_conn_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_hubspot_permissions` (
  `admin_id` INT UNSIGNED NOT NULL,
  `can_extract` TINYINT(1) NOT NULL DEFAULT 0,
  `granted_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `granted_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_id`),
  CONSTRAINT `fk_hubspot_perm_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hubspot_perm_granter`
    FOREIGN KEY (`granted_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`)
VALUES ('my_tasks', 'My Tasks (Work Hub)', 0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
