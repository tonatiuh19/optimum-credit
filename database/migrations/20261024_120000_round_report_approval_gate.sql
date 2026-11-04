-- Progress Report Engine Spec v1.1 P0-1 + §9: publish never sends. A published
-- engine report waits for the language owner (EN Lecca / ES Angel) or a super
-- admin to approve; a failed self-check keeps it out of the send queue.
ALTER TABLE client_round_reports ADD COLUMN `delivery_status` VARCHAR(20) DEFAULT NULL COMMENT 'v1.1: pending_approval | needs_review | sending | sent | silent; NULL = legacy (sent at publish)';
ALTER TABLE client_round_reports ADD COLUMN `self_check_json` JSON DEFAULT NULL COMMENT 'v1.1 §9 checks: [{key, pass (null = n/a), detail}]';
ALTER TABLE client_round_reports ADD COLUMN `delivery_options_json` JSON DEFAULT NULL COMMENT 'Publish-time choices replayed on approval: notify_client, notify_partners';
ALTER TABLE client_round_reports ADD COLUMN `approved_by_admin_id` INT UNSIGNED DEFAULT NULL;
ALTER TABLE client_round_reports ADD COLUMN `approved_at` DATETIME DEFAULT NULL;
ALTER TABLE client_round_reports ADD COLUMN `delivery_result_json` JSON DEFAULT NULL COMMENT 'What approval sent: client_notify, partners_emailed, override reason';
ALTER TABLE client_round_reports ADD INDEX `idx_crr_delivery_status` (`delivery_status`);
