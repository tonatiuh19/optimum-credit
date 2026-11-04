-- Platform billing (OFG pays the platform owner): usage ledger, editable
-- price list, monthly invoices (Stripe). Billing starts at deploy
-- (system_settings.billing_start_at, set by the first production event).

CREATE TABLE IF NOT EXISTS `billing_usage_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `service` VARCHAR(30) NOT NULL COMMENT 'anthropic | mcp | platform',
  `action` VARCHAR(60) NOT NULL COMMENT 'billing_prices.action',
  `quantity` DECIMAL(14,4) NOT NULL DEFAULT 1,
  `unit` VARCHAR(20) NOT NULL DEFAULT 'call',
  `model` VARCHAR(80) DEFAULT NULL,
  `input_tokens` INT UNSIGNED DEFAULT NULL,
  `output_tokens` INT UNSIGNED DEFAULT NULL,
  `cache_read_tokens` INT UNSIGNED DEFAULT NULL,
  `cache_write_tokens` INT UNSIGNED DEFAULT NULL,
  `provider_cost_usd` DECIMAL(12,6) DEFAULT NULL COMMENT 'Real provider cost (informational)',
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `ref_type` VARCHAR(40) DEFAULT NULL,
  `ref_id` VARCHAR(64) DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_billing_usage_occurred` (`occurred_at`),
  KEY `idx_billing_usage_action_occurred` (`action`, `occurred_at`),
  KEY `idx_billing_usage_admin_occurred` (`admin_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_prices` (
  `action` VARCHAR(60) NOT NULL,
  `service` VARCHAR(30) NOT NULL,
  `unit` VARCHAR(20) NOT NULL DEFAULT 'call',
  `unit_price_usd` DECIMAL(12,6) NOT NULL DEFAULT 0,
  `markup` DECIMAL(6,3) NOT NULL DEFAULT 2.000 COMMENT 'Suggested price = measured cost x markup',
  `billable` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = on the invoice; 0 = usage shown only',
  `sort_order` INT NOT NULL DEFAULT 100,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `billing_prices` (`action`, `service`, `unit`, `unit_price_usd`, `billable`, `sort_order`) VALUES
  ('platform_base_fee', 'platform', 'month', 750, 1, 1),
  ('mcp_tool_call', 'mcp', 'call', 0.01, 1, 2),
  ('ai_credit_report_read', 'anthropic', 'call', 0, 0, 10),
  ('ai_credit_review', 'anthropic', 'call', 0, 0, 11),
  ('ai_progress_report', 'anthropic', 'call', 0, 0, 12),
  ('ai_inbound_reply', 'anthropic', 'call', 0, 0, 13),
  ('ai_reply_suggestions', 'anthropic', 'call', 0, 0, 14),
  ('ai_admin_chat', 'anthropic', 'call', 0, 0, 15),
  ('ai_morning_digest', 'anthropic', 'call', 0, 0, 16);

CREATE TABLE IF NOT EXISTS `billing_invoices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period_month` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `period_start` DATETIME NOT NULL,
  `period_end` DATETIME NOT NULL,
  `lines_json` JSON NOT NULL,
  `total_usd` DECIMAL(12,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | open | paid | void | uncollectible | failed',
  `stripe_invoice_id` VARCHAR(64) DEFAULT NULL,
  `hosted_invoice_url` VARCHAR(500) DEFAULT NULL,
  `invoice_pdf_url` VARCHAR(500) DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_billing_invoice_period` (`period_month`),
  KEY `idx_billing_invoice_stripe` (`stripe_invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
