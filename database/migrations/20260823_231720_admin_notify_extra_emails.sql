-- Extra email recipients for team / inbound-SMS alerts (non-admin mailboxes OK).
CREATE TABLE IF NOT EXISTS `admin_notify_extra_emails` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `label` VARCHAR(100) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notify_extra_email` (`email`),
  KEY `idx_notify_extra_active` (`is_active`),
  CONSTRAINT `fk_notify_extra_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_notify_extra_emails` (`email`, `label`, `is_active`) VALUES
  ('support@optimum-financial-group.com', 'Support', 1),
  ('lino@optimum-financial-group.com', 'Lino', 1),
  ('angel@optimum-financial-group.com', 'Angel', 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `is_active` = 1;
