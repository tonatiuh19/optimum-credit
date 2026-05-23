-- ============================================================================
-- Migration: 20260522_000000_payment_splits
-- Adds payment_splits and payment_split_tokens tables.
-- Adds case_id FK to payments table.
-- Extends trigger_event enum on reminder_flows with 'payment_due'.
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

-- Add case_id linkage to payments (for splits that auto-charge)
ALTER TABLE `payments`
  ADD COLUMN `case_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Linked credit repair case, set when payment originates from a split'
    AFTER `package_id`;

ALTER TABLE `payments`
  ADD COLUMN `split_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'payment_splits row that triggered this charge'
    AFTER `case_id`;

-- Extend reminder_flows trigger_event to include payment_due
ALTER TABLE `reminder_flows`
  MODIFY COLUMN `trigger_event`
    ENUM(
      'payment_confirmed',
      'docs_ready',
      'round_1_complete',
      'round_2_complete',
      'round_3_complete',
      'round_4_complete',
      'round_5_complete',
      'completed',
      'payment_due'
    ) NOT NULL;

-- ============================================================================
-- PAYMENT SPLITS (installment schedule per credit repair case)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payment_splits` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id`              INT UNSIGNED NOT NULL,
  `client_id`            INT UNSIGNED NOT NULL  COMMENT 'Denormalised for fast queries',
  `label`                VARCHAR(200) NOT NULL  DEFAULT 'Payment',
  `amount_cents`         INT UNSIGNED NOT NULL,
  `currency`             CHAR(3)      NOT NULL  DEFAULT 'USD',
  `due_date`             DATE         NOT NULL,
  `status`               ENUM('pending','paid','overdue','cancelled')
                                      NOT NULL  DEFAULT 'pending',
  `completion_source`    ENUM('authorize_link','manual') DEFAULT NULL
                                      COMMENT 'How the split was marked paid',
  `paid_at`              DATETIME     DEFAULT NULL,
  `payments_id`          INT UNSIGNED DEFAULT NULL
                                      COMMENT 'Linked payments row when auto-charged',
  `reminder_flow_id`     INT UNSIGNED DEFAULT NULL
                                      COMMENT 'Flow used to schedule reminder emails',
  `send_payment_link`    TINYINT(1)   NOT NULL DEFAULT 0,
  `notes`                TEXT         DEFAULT NULL,
  `created_by_admin_id`  INT UNSIGNED DEFAULT NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_splits_case`       (`case_id`),
  KEY `idx_splits_client`     (`client_id`),
  KEY `idx_splits_status`     (`status`),
  KEY `idx_splits_due_date`   (`due_date`),
  CONSTRAINT `fk_splits_case`    FOREIGN KEY (`case_id`)    REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_splits_client`  FOREIGN KEY (`client_id`)  REFERENCES `clients`(`id`)             ON DELETE CASCADE,
  CONSTRAINT `fk_splits_payment` FOREIGN KEY (`payments_id`) REFERENCES `payments`(`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_splits_flow`    FOREIGN KEY (`reminder_flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_splits_admin`   FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- PAYMENT SPLIT TOKENS (secure one-time payment links)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payment_split_tokens` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `split_id`   INT UNSIGNED NOT NULL,
  `token`      CHAR(36)     NOT NULL UNIQUE COMMENT 'UUID v4',
  `expires_at` DATETIME     NOT NULL,
  `used_at`    DATETIME     DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_split_tokens_token`    (`token`),
  KEY `idx_split_tokens_split`    (`split_id`),
  KEY `idx_split_tokens_expires`  (`expires_at`),
  CONSTRAINT `fk_split_tokens_split`
    FOREIGN KEY (`split_id`) REFERENCES `payment_splits`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add FK constraints on payments for case_id and split_id
-- (done after payment_splits table is created to avoid forward-reference)
ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_split`
    FOREIGN KEY (`split_id`) REFERENCES `payment_splits`(`id`) ON DELETE SET NULL;
