-- Admin AI Ask — audit log for chat turns + tool calls (Phase A)
-- Feature gate: ADMIN_AI_ENABLED env (off by default)

CREATE TABLE IF NOT EXISTS `admin_ai_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `question` TEXT NOT NULL,
  `context_json` JSON DEFAULT NULL,
  `tools_json` JSON DEFAULT NULL,
  `reply_excerpt` VARCHAR(500) DEFAULT NULL,
  `model` VARCHAR(100) DEFAULT NULL,
  `input_tokens` INT UNSIGNED DEFAULT NULL,
  `output_tokens` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('success', 'failure', 'rate_limited', 'disabled') NOT NULL DEFAULT 'success',
  `error_message` VARCHAR(500) DEFAULT NULL,
  `duration_ms` INT UNSIGNED DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_ai_audit_admin_created` (`admin_id`, `created_at`),
  KEY `idx_admin_ai_audit_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_admin_ai_audit_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
