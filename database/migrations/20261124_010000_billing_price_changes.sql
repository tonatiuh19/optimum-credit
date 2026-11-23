-- Scheduled billing price changes (Nov 24, 2026). A row = "from effective_month, this action costs X".
-- The billing cron applies due rows right after the previous month's invoice exists (that invoice
-- keeps its own lines), marks them applied_at, and keeps them as history. Reuse: insert new rows.
CREATE TABLE IF NOT EXISTS `billing_price_changes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `effective_month` CHAR(7) NOT NULL COMMENT 'YYYY-MM (UTC): first month billed at the new price',
  `action` VARCHAR(64) NOT NULL COMMENT 'billing_prices.action',
  `unit_price_usd` DECIMAL(12,6) NOT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `applied_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_billing_price_change` (`effective_month`, `action`),
  KEY `idx_billing_price_changes_pending` (`applied_at`, `effective_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OFG Operating Suite $582.00 → $671.00/month (+$89) from the December 2026 invoice, split
-- proportionally (+15.29% per service, to the cent; adds up to exactly $671.00).
-- November is still billed at $582 (its invoice is created Dec 1, before this applies).
INSERT IGNORE INTO `billing_price_changes` (`effective_month`, `action`, `unit_price_usd`, `note`) VALUES
  ('2026-12', 'suite_credit_intelligence', 175.65, 'Suite $582 → $671 (+$89)'),
  ('2026-12', 'suite_communications_hub', 126.59, 'Suite $582 → $671 (+$89)'),
  ('2026-12', 'suite_cloud_infrastructure', 109.99, 'Suite $582 → $671 (+$89)'),
  ('2026-12', 'suite_crm_automations', 109.12, 'Suite $582 → $671 (+$89)'),
  ('2026-12', 'suite_managed_support', 86.30, 'Suite $582 → $671 (+$89)'),
  ('2026-12', 'suite_security_compliance', 63.35, 'Suite $582 → $671 (+$89)');
