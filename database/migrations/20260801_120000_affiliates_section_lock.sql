-- Add nav section-lock rows for the affiliate-facing panels so admins can
-- toggle "Affiliates" (staff CRM) and "My Affiliate" (affiliate self-service
-- portal) from Settings, consistent with every other nav section.
INSERT INTO section_locks (section_key, label, is_locked, lock_reason) VALUES
  ('affiliates', 'Affiliates', 0, NULL),
  ('affiliate-portal', 'My Affiliate', 0, NULL)
ON DUPLICATE KEY UPDATE label = VALUES(label);
