-- #ofg-onboarding Slack alert (Nov 6, 2026): each client is posted once, the first time
-- they become a client. Existing clients are stamped so none of them is posted again.
ALTER TABLE clients ADD COLUMN onboarding_alerted_at DATETIME DEFAULT NULL AFTER activation_notified_at;
UPDATE clients SET onboarding_alerted_at = COALESCE(pipeline_stage_changed_at, created_at)
 WHERE onboarding_alerted_at IS NULL AND status NOT IN ('prospect', 'funding', 'pending_payment');
