-- Conversation hub reply templates (separate from communication_templates / reminder flows).
-- TiDB Cloud Serverless (MySQL 8.0 compatible)

CREATE TABLE IF NOT EXISTS `conversation_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `channel` ENUM('sms','email','internal') NOT NULL DEFAULT 'sms',
  `subject` VARCHAR(255) DEFAULT NULL COMMENT 'Email subject; unused for sms/internal',
  `body` MEDIUMTEXT NOT NULL,
  `variables_json` JSON DEFAULT NULL COMMENT 'Suggested vars e.g. ["first_name","portal_url"]',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conv_tmpl_channel_active` (`channel`, `is_active`),
  KEY `idx_conv_tmpl_sort` (`sort_order`, `id`),
  CONSTRAINT `fk_conv_tmpl_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed defaults only when table is empty (idempotent re-run safe)
INSERT INTO `conversation_templates`
  (`name`, `channel`, `subject`, `body`, `variables_json`, `is_active`, `sort_order`)
SELECT
  v.name, v.channel, v.subject, v.body, v.variables_json, v.is_active, v.sort_order
FROM (
  SELECT
    'SMS — Quick intro' AS name,
    'sms' AS channel,
    CAST(NULL AS CHAR) AS subject,
    'Hi {{first_name}}, this is Optimum Credit. How can we help you today?' AS body,
    JSON_ARRAY('first_name') AS variables_json,
    1 AS is_active,
    10 AS sort_order
  UNION ALL
  SELECT
    'SMS — Docs reminder',
    'sms',
    CAST(NULL AS CHAR),
    'Hi {{first_name}}, we still need your documents to keep your case moving. Upload here: {{portal_url}}',
    JSON_ARRAY('first_name', 'portal_url'),
    1,
    20
  UNION ALL
  SELECT
    'Email — Follow up',
    'email',
    'Following up — Optimum Credit',
    'Hi {{first_name}},\n\nJust checking in on your credit repair case. Reply to this email or text us anytime.\n\n— Optimum Credit Team',
    JSON_ARRAY('first_name', 'full_name', 'email'),
    1,
    30
) AS v
WHERE (SELECT COUNT(*) FROM `conversation_templates`) = 0;
