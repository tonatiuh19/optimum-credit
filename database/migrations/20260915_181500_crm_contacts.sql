-- Independent CRM contacts (address book) — not pipeline clients until convert.
-- Soft-delete via deleted_at; convert archives via converted_client_id + converted_at.
-- Conversations may attach to contact_id (XOR with client_id / unknown_contact_id).

CREATE TABLE IF NOT EXISTS `contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  `zip` VARCHAR(20) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `admin_notes` TEXT DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `converted_client_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when contact is added to pipeline as a prospect client',
  `converted_at` DATETIME DEFAULT NULL,
  `deleted_at` DATETIME DEFAULT NULL
    COMMENT 'Soft-delete; row kept for conversation history',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contacts_email` (`email`),
  KEY `idx_contacts_phone` (`phone`),
  KEY `idx_contacts_deleted` (`deleted_at`),
  KEY `idx_contacts_converted` (`converted_client_id`),
  KEY `idx_contacts_created` (`created_at`),
  KEY `idx_contacts_assigned` (`assigned_admin_id`),
  CONSTRAINT `fk_contacts_assigned_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contacts_created_by`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contacts_converted_client`
    FOREIGN KEY (`converted_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attach Conversations threads to CRM contacts (before pipeline convert).
-- TiDB: add column / index / FK as separate statements (combined ALTER can fail).
ALTER TABLE `conversations`
  ADD COLUMN `contact_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'CRM contacts.id when thread is tied to a saved contact (not client/unknown)';

ALTER TABLE `conversations`
  ADD KEY `idx_conversations_contact` (`contact_id`);

ALTER TABLE `conversations`
  ADD CONSTRAINT `fk_conversations_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL;

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`)
VALUES ('contacts', 'Contacts', 0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
