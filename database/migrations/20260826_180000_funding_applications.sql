-- Business Funding: separate applications board (not Credit Repair pipeline),
-- encrypted PII, funding doc types, notify-from OFG number setting, Joe Pepe seed.

-- ---------------------------------------------------------------------------
-- clients.status: funding-only leads (excluded from CR Prospect column)
-- ---------------------------------------------------------------------------
ALTER TABLE `clients`
  MODIFY COLUMN `status` ENUM(
    'prospect',
    'funding',
    'pending_payment',
    'onboarding',
    'active',
    'paused',
    'cancelled'
  ) NOT NULL DEFAULT 'pending_payment';

-- ---------------------------------------------------------------------------
-- funding_applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `funding_applications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_token` CHAR(36) NOT NULL,
  `funding_type` ENUM('credit_card_stacking','bank_statements') NOT NULL,
  `status` ENUM(
    'draft',
    'awaiting_docs',
    'submitted',
    'under_review',
    'complete',
    'converted',
    'cancelled'
  ) NOT NULL DEFAULT 'draft',
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `postal_code` VARCHAR(20) DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `llc_name` VARCHAR(255) DEFAULT NULL,
  `llc_address` VARCHAR(500) DEFAULT NULL,
  `secrets_ciphertext` MEDIUMBLOB DEFAULT NULL,
  `secrets_iv` VARCHAR(64) DEFAULT NULL,
  `secrets_tag` VARCHAR(64) DEFAULT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `converted_prospect_client_id` INT UNSIGNED DEFAULT NULL,
  `converted_at` DATETIME DEFAULT NULL,
  `converted_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `docs_complete_notified_at` DATETIME DEFAULT NULL,
  `submitted_at` DATETIME DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_funding_public_token` (`public_token`),
  KEY `idx_funding_status` (`status`),
  KEY `idx_funding_email` (`email`),
  KEY `idx_funding_client` (`client_id`),
  KEY `idx_funding_created` (`created_at`),
  CONSTRAINT `fk_funding_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_funding_converted_client`
    FOREIGN KEY (`converted_prospect_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_funding_converted_by`
    FOREIGN KEY (`converted_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- client_documents: funding slots + optional application link
-- ---------------------------------------------------------------------------
ALTER TABLE `client_documents`
  MODIFY COLUMN `doc_type` ENUM(
    'id_front',
    'id_back',
    'ssn_card',
    'proof_of_address',
    'other',
    'funding_drivers_license',
    'funding_corp_statement',
    'funding_bank_m1',
    'funding_bank_m2',
    'funding_bank_m3',
    'funding_bank_m4',
    'funding_bank_m5',
    'funding_bank_m6'
  ) NOT NULL;

-- TiDB: add column, then key, then FK as separate ALTERs
ALTER TABLE `client_documents`
  ADD COLUMN `funding_application_id` INT UNSIGNED DEFAULT NULL AFTER `case_id`;

ALTER TABLE `client_documents`
  ADD KEY `idx_client_docs_funding` (`funding_application_id`);

ALTER TABLE `client_documents`
  ADD CONSTRAINT `fk_client_docs_funding`
    FOREIGN KEY (`funding_application_id`) REFERENCES `funding_applications`(`id`)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Org setting: which OFG inventory number sends funding client SMS
-- (value = admin_phone_numbers.id as string; empty until configured in Settings)
-- ---------------------------------------------------------------------------
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES (
  'funding_sms_from_phone_number_id',
  '',
  'admin_phone_numbers.id used as From for funding client confirmation SMS'
)
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- Default to Cesar OFG line when present and setting still empty
UPDATE `system_settings` ss
JOIN `admin_phone_numbers` p
  ON p.friendly_name LIKE 'Cesar OFG%' AND p.is_active = 1
SET ss.setting_value = CAST(p.id AS CHAR)
WHERE ss.setting_key = 'funding_sms_from_phone_number_id'
  AND (ss.setting_value IS NULL OR ss.setting_value = '');

-- ---------------------------------------------------------------------------
-- Joe Pepe: email-only extra recipient for funding doc uploads
-- ---------------------------------------------------------------------------
INSERT INTO `admin_notify_extra_emails` (`email`, `label`, `is_active`, `events_json`)
VALUES (
  'joepepe@lexingtoncapitalholdings.com',
  'Joe Pepe',
  1,
  JSON_ARRAY('funding_doc_upload')
)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `is_active` = 1,
  `events_json` = VALUES(`events_json`);

-- Admin nav section lock row (unlocked)
INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`)
VALUES ('funding', 'Funding', 0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
