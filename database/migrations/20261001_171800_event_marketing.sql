-- Event Marketing CRM section: companies, series, sessions, form fields, registrations.
-- Public landings: /e and /e/:companySlug (+ optional /s/:sessionCode).
-- Labels + section lock + Reminder Flows trigger `event_registered`.

ALTER TABLE `reminder_flows`
  MODIFY COLUMN `trigger_event` ENUM(
    'payment_confirmed',
    'docs_ready',
    'round_1_complete',
    'round_2_complete',
    'round_3_complete',
    'round_4_complete',
    'round_5_complete',
    'round_extended_complete',
    'completed',
    'payment_due',
    'event_registered'
  ) NOT NULL;

INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`) VALUES
  ('event_marketing', 'Event marketing', 'Marketing de eventos', 'source', 'primary', 1, 28),
  ('ofy', 'Options for Youth (OFY)', 'Options for Youth (OFY)', 'source', 'accent', 1, 29),
  ('allegiance', 'Allegiance STEAM Academy', 'Allegiance STEAM Academy', 'source', 'accent', 1, 30)
ON DUPLICATE KEY UPDATE
  `name_en` = VALUES(`name_en`),
  `name_es` = VALUES(`name_es`);

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`)
VALUES ('event-marketing', 'Event Marketing', 0, NULL)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

CREATE TABLE IF NOT EXISTS `event_companies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `name_es` VARCHAR(200) DEFAULT NULL,
  `label_slug` VARCHAR(80) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `welcome_heading_en` VARCHAR(500) NOT NULL,
  `welcome_heading_es` VARCHAR(500) NOT NULL,
  `welcome_body_en` TEXT NOT NULL,
  `welcome_body_es` TEXT NOT NULL,
  `offer_free_report` TINYINT(1) NOT NULL DEFAULT 1,
  `offer_comic` TINYINT(1) NOT NULL DEFAULT 0,
  `class_link_url` VARCHAR(500) DEFAULT NULL,
  `class_schedule_note_en` VARCHAR(500) DEFAULT NULL,
  `class_schedule_note_es` VARCHAR(500) DEFAULT NULL,
  `email_subject_en` VARCHAR(500) NOT NULL,
  `email_subject_es` VARCHAR(500) NOT NULL,
  `email_body_en` TEXT NOT NULL,
  `email_body_es` TEXT NOT NULL,
  `sms_body_en` VARCHAR(500) NOT NULL,
  `sms_body_es` VARCHAR(500) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_companies_slug` (`slug`),
  KEY `idx_event_companies_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_series` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` INT UNSIGNED NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_es` VARCHAR(200) NOT NULL,
  `kind` ENUM('in_person','online','hybrid') NOT NULL DEFAULT 'in_person',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_series_company_slug` (`company_id`, `slug`),
  KEY `idx_event_series_company` (`company_id`, `is_active`, `sort_order`),
  CONSTRAINT `fk_event_series_company` FOREIGN KEY (`company_id`) REFERENCES `event_companies`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` INT UNSIGNED NOT NULL,
  `series_id` INT UNSIGNED NOT NULL,
  `short_code` VARCHAR(32) NOT NULL,
  `title_en` VARCHAR(255) NOT NULL,
  `title_es` VARCHAR(255) NOT NULL,
  `starts_at` DATETIME NOT NULL COMMENT 'Wall time in America/Los_Angeles (stored as DATETIME)',
  `ends_at` DATETIME DEFAULT NULL,
  `location_en` VARCHAR(500) DEFAULT NULL,
  `location_es` VARCHAR(500) DEFAULT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('scheduled','cancelled','completed') NOT NULL DEFAULT 'scheduled',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_sessions_short_code` (`short_code`),
  KEY `idx_event_sessions_company_starts` (`company_id`, `status`, `starts_at`),
  KEY `idx_event_sessions_series` (`series_id`, `starts_at`),
  CONSTRAINT `fk_event_sessions_company` FOREIGN KEY (`company_id`) REFERENCES `event_companies`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_sessions_series` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_form_fields` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` INT UNSIGNED NOT NULL,
  `field_key` VARCHAR(64) NOT NULL,
  `label_en` VARCHAR(200) NOT NULL,
  `label_es` VARCHAR(200) NOT NULL,
  `field_type` ENUM('text','email','phone','textarea','select','checkbox','language') NOT NULL DEFAULT 'text',
  `options_json` JSON DEFAULT NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_form_fields_company_key` (`company_id`, `field_key`),
  KEY `idx_event_form_fields_company` (`company_id`, `is_active`, `sort_order`),
  CONSTRAINT `fk_event_form_fields_company` FOREIGN KEY (`company_id`) REFERENCES `event_companies`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_registrations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `company_id` INT UNSIGNED NOT NULL,
  `series_id` INT UNSIGNED DEFAULT NULL,
  `session_id` INT UNSIGNED DEFAULT NULL,
  `answers_json` JSON DEFAULT NULL,
  `source_qr` ENUM('company','session') NOT NULL DEFAULT 'company',
  `checked_in_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_reg_client` (`client_id`),
  KEY `idx_event_reg_company` (`company_id`, `created_at`),
  KEY `idx_event_reg_session` (`session_id`),
  CONSTRAINT `fk_event_reg_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_reg_company` FOREIGN KEY (`company_id`) REFERENCES `event_companies`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_reg_series` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_reg_session` FOREIGN KEY (`session_id`) REFERENCES `event_sessions`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed OFY + Allegiance (Oct sessions). Staff add the rest in CRM.
INSERT INTO `event_companies` (
  `slug`, `name`, `name_es`, `label_slug`, `is_active`, `sort_order`,
  `welcome_heading_en`, `welcome_heading_es`,
  `welcome_body_en`, `welcome_body_es`,
  `offer_free_report`, `offer_comic`,
  `class_link_url`, `class_schedule_note_en`, `class_schedule_note_es`,
  `email_subject_en`, `email_subject_es`,
  `email_body_en`, `email_body_es`,
  `sms_body_en`, `sms_body_es`
) VALUES
(
  'ofy',
  'Options for Youth (OFY)',
  'Options for Youth (OFY)',
  'ofy',
  1,
  10,
  'Welcome to Mastering Your Money with Options for Youth and Optimum Financial Group!',
  '¡Bienvenidos a Mastering Your Money con Options for Youth y Optimum Financial Group!',
  'Sign up for the free Family Fun Night and the parent class. Every family receives a free credit report and a financial literacy comic book. The Mastering Your Money class is held via Zoom — we will text and email you the class link and schedule after you register.',
  'Regístrate a la Family Fun Night gratis y a la clase para padres. Cada familia recibe un reporte de crédito gratis y un cómic de educación financiera. La clase Mastering Your Money es por Zoom — te enviaremos por SMS y correo el enlace y el horario después de registrarte.',
  1,
  1,
  NULL,
  'Session days + times: confirm with Brock before this goes live.',
  'Días y horarios de la clase: confirmar con Brock antes de publicar.',
  'You''re registered — Family Fun Night + Mastering Your Money',
  'Estás registrado — Family Fun Night + Mastering Your Money',
  'Thanks {{first_name}}! You''re signed up for {{session_title}} ({{session_when}}{{session_location}}).{{class_note}} Every family gets a free credit report{{comic_note}}. Free report: {{report_url}}',
  '¡Gracias {{first_name}}! Te registraste para {{session_title}} ({{session_when}}{{session_location}}).{{class_note}} Cada familia recibe un reporte de crédito gratis{{comic_note}}. Reporte gratis: {{report_url}}',
  'Hi {{first_name}}, you''re in for {{session_title}} {{session_when}}. Free report: {{report_url}}',
  'Hola {{first_name}}, estás registrado/a en {{session_title}} {{session_when}}. Reporte gratis: {{report_url}}'
),
(
  'allegiance',
  'Allegiance STEAM Academy',
  'Allegiance STEAM Academy',
  'allegiance',
  1,
  20,
  'Welcome — Allegiance STEAM Academy + Optimum Financial Group',
  'Bienvenidos — Allegiance STEAM Academy + Optimum Financial Group',
  'Sign up for the upcoming family event with Allegiance STEAM Academy. Every family receives a free credit report. We will confirm details by text and email after you register.',
  'Regístrate al próximo evento familiar con Allegiance STEAM Academy. Cada familia recibe un reporte de crédito gratis. Confirmaremos los detalles por SMS y correo después de registrarte.',
  1,
  0,
  NULL,
  NULL,
  NULL,
  'You''re registered — Allegiance STEAM + OFG',
  'Estás registrado — Allegiance STEAM + OFG',
  'Thanks {{first_name}}! You''re signed up for {{session_title}} ({{session_when}}{{session_location}}). Free report: {{report_url}}',
  '¡Gracias {{first_name}}! Te registraste para {{session_title}} ({{session_when}}{{session_location}}). Reporte gratis: {{report_url}}',
  'Hi {{first_name}}, you''re in for {{session_title}} {{session_when}}. Free report: {{report_url}}',
  'Hola {{first_name}}, estás registrado/a en {{session_title}} {{session_when}}. Reporte gratis: {{report_url}}'
);

SET @ofy_id = (SELECT id FROM event_companies WHERE slug = 'ofy' LIMIT 1);
SET @alg_id = (SELECT id FROM event_companies WHERE slug = 'allegiance' LIMIT 1);

INSERT INTO `event_series` (`company_id`, `slug`, `name_en`, `name_es`, `kind`, `is_active`, `sort_order`) VALUES
  (@ofy_id, 'family-fun-night', 'Family Fun Night', 'Family Fun Night', 'in_person', 1, 10),
  (@ofy_id, 'mastering-your-money', 'Mastering Your Money', 'Mastering Your Money', 'online', 1, 20),
  (@alg_id, 'steam-family-night', 'STEAM Family Night', 'Noche familiar STEAM', 'in_person', 1, 10);

SET @ofy_ffn = (SELECT id FROM event_series WHERE company_id = @ofy_id AND slug = 'family-fun-night' LIMIT 1);
SET @ofy_mym = (SELECT id FROM event_series WHERE company_id = @ofy_id AND slug = 'mastering-your-money' LIMIT 1);
SET @alg_steam = (SELECT id FROM event_series WHERE company_id = @alg_id AND slug = 'steam-family-night' LIMIT 1);

INSERT INTO `event_sessions` (
  `company_id`, `series_id`, `short_code`, `title_en`, `title_es`,
  `starts_at`, `ends_at`, `location_en`, `location_es`, `capacity`, `status`
) VALUES
  (@ofy_id, @ofy_ffn, 'ofy-chino-1001', 'Family Fun Night — Chino', 'Family Fun Night — Chino',
   '2026-10-01 17:00:00', '2026-10-01 19:00:00', '7011 Schaefer Ave Ste E, Chino', '7011 Schaefer Ave Ste E, Chino', NULL, 'scheduled'),
  (@ofy_id, @ofy_ffn, 'ofy-fontana-1008', 'Family Fun Night — Fontana', 'Family Fun Night — Fontana',
   '2026-10-08 17:00:00', '2026-10-08 19:00:00', 'Fontana', 'Fontana', NULL, 'scheduled'),
  (@ofy_id, @ofy_ffn, 'ofy-fontana-rc-1022', 'Family Fun Night — Fontana + Rancho Cucamonga', 'Family Fun Night — Fontana + Rancho Cucamonga',
   '2026-10-22 17:00:00', '2026-10-22 19:00:00', 'Fontana + Rancho Cucamonga', 'Fontana + Rancho Cucamonga', NULL, 'scheduled'),
  (@ofy_id, @ofy_ffn, 'ofy-upland-1029', 'Family Fun Night — Upland', 'Family Fun Night — Upland',
   '2026-10-29 17:00:00', '2026-10-29 19:00:00', 'Upland', 'Upland', NULL, 'scheduled'),
  (@ofy_id, @ofy_mym, 'ofy-mym-nov2026', 'Mastering Your Money (Zoom class)', 'Mastering Your Money (clase Zoom)',
   '2026-11-03 18:00:00', NULL, 'Online via Zoom — schedule TBD with Brock', 'En línea por Zoom — horario por confirmar con Brock', NULL, 'scheduled'),
  (@alg_id, @alg_steam, 'alg-chino-1007', 'STEAM Family Night — Chino', 'Noche familiar STEAM — Chino',
   '2026-10-07 17:30:00', '2026-10-07 18:30:00', 'Chino', 'Chino', NULL, 'scheduled');

-- Default form fields (system + optional) for both companies
INSERT INTO `event_form_fields`
  (`company_id`, `field_key`, `label_en`, `label_es`, `field_type`, `options_json`, `is_required`, `is_system`, `is_active`, `sort_order`)
SELECT c.id, v.field_key, v.label_en, v.label_es, v.field_type, v.options_json, v.is_required, v.is_system, 1, v.sort_order
FROM event_companies c
CROSS JOIN (
  SELECT 'first_name' AS field_key, 'First name' AS label_en, 'Nombre' AS label_es, 'text' AS field_type, NULL AS options_json, 1 AS is_required, 1 AS is_system, 10 AS sort_order
  UNION ALL SELECT 'last_name', 'Last name', 'Apellido', 'text', NULL, 1, 1, 20
  UNION ALL SELECT 'email', 'Email', 'Correo', 'email', NULL, 1, 1, 30
  UNION ALL SELECT 'phone', 'Phone', 'Teléfono', 'phone', NULL, 1, 1, 40
  UNION ALL SELECT 'preferred_language', 'Preferred language', 'Idioma preferido', 'language', NULL, 1, 1, 50
  UNION ALL SELECT 'interest_class', 'I want the Mastering Your Money Zoom class', 'Quiero la clase Zoom Mastering Your Money', 'checkbox', NULL, 0, 0, 60
  UNION ALL SELECT 'notes', 'Notes (optional)', 'Notas (opcional)', 'textarea', NULL, 0, 0, 70
) v
WHERE c.slug IN ('ofy', 'allegiance');

-- Allegiance: hide OFY-specific class checkbox by default
UPDATE `event_form_fields` f
JOIN `event_companies` c ON c.id = f.company_id
SET f.is_active = 0, f.label_en = 'I want parent/financial class updates', f.label_es = 'Quiero actualizaciones de la clase para padres'
WHERE c.slug = 'allegiance' AND f.field_key = 'interest_class';
