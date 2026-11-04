-- OFG Operating Suite reduced from $750 to $580/month (proportional, rounded).
UPDATE billing_prices SET unit_price_usd = 150 WHERE action = 'suite_credit_intelligence';
UPDATE billing_prices SET unit_price_usd = 110 WHERE action = 'suite_communications_hub';
UPDATE billing_prices SET unit_price_usd = 95 WHERE action = 'suite_crm_automations';
UPDATE billing_prices SET unit_price_usd = 95 WHERE action = 'suite_cloud_infrastructure';
UPDATE billing_prices SET unit_price_usd = 55 WHERE action = 'suite_security_compliance';
UPDATE billing_prices SET unit_price_usd = 75 WHERE action = 'suite_managed_support';
