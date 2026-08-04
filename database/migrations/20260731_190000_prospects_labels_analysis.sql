-- Prospects, labels, credit analysis, reminder label filters, docs_ready seed
-- TiDB / MySQL 8 compatible

-- 1) Clients: prospect status + prospect pipeline stage
ALTER TABLE `clients`
  MODIFY COLUMN `status` ENUM(
    'prospect','pending_payment','onboarding','active','paused','cancelled'
  ) NOT NULL DEFAULT 'pending_payment';

ALTER TABLE `clients`
  MODIFY COLUMN `pipeline_stage` ENUM(
    'prospect','new_client','docs_ready','round_1','round_2','round_3','round_4','round_5','completed','cancelled'
  ) NOT NULL DEFAULT 'new_client';

ALTER TABLE `credit_repair_cases`
  MODIFY COLUMN `pipeline_stage` ENUM(
    'prospect','new_client','docs_ready','round_1','round_2','round_3','round_4','round_5','completed','cancelled'
  ) NOT NULL DEFAULT 'new_client';

-- 2) Labels (source + analysis layers)
CREATE TABLE IF NOT EXISTS `labels` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(120) NOT NULL,
  `name_es` VARCHAR(120) NOT NULL,
  `layer` ENUM('source','analysis') NOT NULL,
  `color` VARCHAR(30) NOT NULL DEFAULT 'primary',
  `is_system` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_labels_slug` (`slug`),
  KEY `idx_labels_layer` (`layer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_labels` (
  `client_id` INT UNSIGNED NOT NULL,
  `label_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`client_id`, `label_id`),
  KEY `idx_client_labels_label` (`label_id`),
  CONSTRAINT `fk_client_labels_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_labels_label` FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`) VALUES
  ('web_analysis', 'Web analysis', 'Análisis web', 'source', 'primary', 1, 10),
  ('get_started_wizard', 'Get started lead', 'Lead inicio', 'source', 'secondary', 1, 20),
  ('agent_submission', 'Agent submission', 'Envío de agente', 'source', 'accent', 1, 30),
  ('referral', 'Referral', 'Referido', 'source', 'muted', 1, 40),
  ('housing', 'Housing / Mortgage', 'Vivienda / Hipoteca', 'analysis', 'primary', 1, 100),
  ('auto', 'Auto loan', 'Préstamo de auto', 'analysis', 'accent', 1, 110),
  ('credit_card', 'Credit card', 'Tarjeta de crédito', 'analysis', 'destructive', 1, 120),
  ('collections', 'Collections', 'Cobros', 'analysis', 'destructive', 1, 130),
  ('student_loan', 'Student loan', 'Préstamo estudiantil', 'analysis', 'secondary', 1, 140),
  ('personal_loan', 'Personal loan', 'Préstamo personal', 'analysis', 'secondary', 1, 150),
  ('medical', 'Medical', 'Médico', 'analysis', 'muted', 1, 160),
  ('bankruptcy', 'Bankruptcy', 'Bancarrota', 'analysis', 'destructive', 1, 170),
  ('inquiry', 'Hard inquiry', 'Consulta dura', 'analysis', 'muted', 1, 180),
  ('other_derogatory', 'Other derogatory', 'Otro negativo', 'analysis', 'muted', 1, 190)
ON DUPLICATE KEY UPDATE
  `name_en` = VALUES(`name_en`),
  `name_es` = VALUES(`name_es`);

-- 3) Credit analysis records (public generate)
CREATE TABLE IF NOT EXISTS `credit_analyses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `mode` ENUM('client','agent') NOT NULL DEFAULT 'client',
  `submitter_first_name` VARCHAR(100) DEFAULT NULL,
  `submitter_last_name` VARCHAR(100) DEFAULT NULL,
  `agent_phone` VARCHAR(30) DEFAULT NULL,
  `rep_name` VARCHAR(150) DEFAULT NULL,
  `client_goal` VARCHAR(255) DEFAULT NULL,
  `text_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notes` TEXT DEFAULT NULL,
  `report_file_name` VARCHAR(255) DEFAULT NULL,
  `report_mime_type` VARCHAR(100) DEFAULT NULL,
  `report_storage_key` VARCHAR(500) DEFAULT NULL,
  `provider_detected` VARCHAR(40) DEFAULT NULL,
  `scores_json` JSON DEFAULT NULL,
  `negatives_json` JSON DEFAULT NULL,
  `labels_suggested_json` JSON DEFAULT NULL,
  `analysis_html` MEDIUMTEXT DEFAULT NULL,
  `analysis_text` MEDIUMTEXT DEFAULT NULL,
  `email_opt_in` TINYINT(1) NOT NULL DEFAULT 0,
  `email_sent_at` DATETIME DEFAULT NULL,
  `generated_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_credit_analyses_client` (`client_id`),
  KEY `idx_credit_analyses_generated` (`generated_at`),
  CONSTRAINT `fk_credit_analyses_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Optional label filter on reminder flows (JSON array of label slugs; empty = all)
ALTER TABLE `reminder_flows`
  ADD COLUMN `required_label_slugs_json` JSON DEFAULT NULL
    COMMENT 'If set, flow only runs when client has ALL listed label slugs'
  AFTER `is_active`;

-- 5) Seed docs_ready reminder flow (idempotent by name)
INSERT INTO `reminder_flows` (`name`, `description`, `trigger_event`, `is_active`)
SELECT 'Docs verified — client notify', 'Sent when a case enters docs_ready', 'docs_ready', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `reminder_flows` WHERE `trigger_event` = 'docs_ready' AND `name` = 'Docs verified — client notify'
);

SET @docs_flow_id := (
  SELECT `id` FROM `reminder_flows`
  WHERE `trigger_event` = 'docs_ready' AND `name` = 'Docs verified — client notify'
  LIMIT 1
);

INSERT INTO `reminder_flow_steps`
  (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `subject`, `body`)
SELECT @docs_flow_id, 0, 'send_email', 0, 'Docs ready day 0',
  'Great news, {{first_name}} — your documents are verified',
  '<p>Hi {{first_name}},</p><p>All required documents have been verified. Our team is now working on your credit repair case.</p><p>Track progress anytime: <a href="{{portal_url}}">{{portal_url}}</a></p>'
FROM DUAL
WHERE @docs_flow_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `reminder_flow_steps` WHERE `flow_id` = @docs_flow_id AND `step_order` = 0
  );
