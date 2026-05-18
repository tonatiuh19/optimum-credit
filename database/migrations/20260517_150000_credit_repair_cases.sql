-- ============================================================================
-- Migration: credit_repair_cases
-- Date: 2026-05-17
-- Description: Introduce credit_repair_cases table so one client can have
--              multiple credit-repair engagements over time. Each payment
--              creates a new case. Backfill one case per existing client.
--              Add case_id FK to client_documents and client_round_reports.
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create credit_repair_cases table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `credit_repair_cases` (
  `id`                        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `case_number`               VARCHAR(20)   DEFAULT NULL UNIQUE COMMENT 'e.g. CR-00001; set after INSERT via UPDATE',
  `client_id`                 INT UNSIGNED  NOT NULL,
  `package_id`                INT UNSIGNED  DEFAULT NULL,
  `pipeline_stage`            ENUM('new_client','docs_ready','round_1','round_2','round_3','round_4','round_5','completed','cancelled')
                                            NOT NULL DEFAULT 'new_client',
  `pipeline_stage_changed_at` DATETIME      DEFAULT NULL,
  `status`                    ENUM('active','completed','cancelled','on_hold')
                                            NOT NULL DEFAULT 'active',
  `notes`                     TEXT          DEFAULT NULL,
  `created_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cases_client`  (`client_id`),
  KEY `idx_cases_stage`   (`pipeline_stage`),
  KEY `idx_cases_status`  (`status`),
  CONSTRAINT `fk_cases_client`  FOREIGN KEY (`client_id`)  REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cases_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Backfill: one case per existing client (case_number NULL → updated below)
-- ---------------------------------------------------------------------------
INSERT INTO `credit_repair_cases`
  (`case_number`, `client_id`, `package_id`, `pipeline_stage`, `pipeline_stage_changed_at`, `status`, `created_at`)
SELECT
  NULL,
  `id`,
  `package_id`,
  COALESCE(`pipeline_stage`, 'new_client'),
  `pipeline_stage_changed_at`,
  CASE
    WHEN `status` = 'cancelled'              THEN 'cancelled'
    WHEN `pipeline_stage` = 'completed'      THEN 'completed'
    ELSE 'active'
  END,
  `created_at`
FROM `clients`;

-- Generate case_number from each case's own auto-increment id
UPDATE `credit_repair_cases`
SET `case_number` = CONCAT('CR-', LPAD(`id`, 5, '0'))
WHERE `case_number` IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Add case_id FK to client_documents
-- ---------------------------------------------------------------------------
ALTER TABLE `client_documents`
  ADD COLUMN IF NOT EXISTS `case_id` INT UNSIGNED DEFAULT NULL AFTER `client_id`;

-- Backfill: link each doc to its client's (only) case
UPDATE `client_documents` d
  JOIN `credit_repair_cases` c ON c.client_id = d.client_id
SET d.case_id = c.id;

-- Add FK constraint (skip if already exists — re-running is safe because of IF NOT EXISTS on column)
ALTER TABLE `client_documents`
  ADD CONSTRAINT `fk_docs_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL;

-- Index for fast per-case doc lookups
ALTER TABLE `client_documents`
  ADD KEY IF NOT EXISTS `idx_client_docs_case` (`case_id`);

-- ---------------------------------------------------------------------------
-- 4. Add case_id FK to client_round_reports
-- ---------------------------------------------------------------------------
ALTER TABLE `client_round_reports`
  ADD COLUMN IF NOT EXISTS `case_id` INT UNSIGNED DEFAULT NULL AFTER `client_id`;

-- Backfill
UPDATE `client_round_reports` r
  JOIN `credit_repair_cases` c ON c.client_id = r.client_id
SET r.case_id = c.id;

ALTER TABLE `client_round_reports`
  ADD CONSTRAINT `fk_reports_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE SET NULL;

ALTER TABLE `client_round_reports`
  ADD KEY IF NOT EXISTS `idx_round_reports_case` (`case_id`);
