-- OFG Operating Suite: the $750/month base fee split into 6 service lines
-- (each a monthly, billable price; same total). Replaces platform_base_fee.
-- Idempotent.
INSERT INTO billing_prices (action, service, unit, unit_price_usd, billable, sort_order) VALUES
  ('suite_credit_intelligence', 'suite', 'month', 195, 1, 1),
  ('suite_communications_hub', 'suite', 'month', 140, 1, 2),
  ('suite_crm_automations', 'suite', 'month', 125, 1, 3),
  ('suite_cloud_infrastructure', 'suite', 'month', 120, 1, 4),
  ('suite_security_compliance', 'suite', 'month', 70, 1, 5),
  ('suite_managed_support', 'suite', 'month', 100, 1, 6)
ON DUPLICATE KEY UPDATE service = VALUES(service), unit = VALUES(unit), sort_order = VALUES(sort_order);
UPDATE billing_prices SET sort_order = 7 WHERE action = 'mcp_tool_call';
DELETE FROM billing_prices WHERE action = 'platform_base_fee';
