-- Signup / activation notifications (César Sep 3 addendum)
-- TiDB Cloud Serverless / MySQL 8.0 compatible

-- Deduplicate client+partner activation SMS/email (convert vs paid enrollment)
ALTER TABLE `clients`
  ADD COLUMN `activation_notified_at` DATETIME DEFAULT NULL
    COMMENT 'When signup activation SMS/email fan-out last ran'
    AFTER `pipeline_stage_changed_at`;

-- Force partner round/signup notifies ON (remove human toggle failure mode)
UPDATE `client_referrers` SET `notify_on_round` = 1 WHERE `notify_on_round` = 0;

-- OFG From for automated client/referrer activation SMS (Lecca line)
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES (
  'signup_notify_sms_from_phone_number_id',
  '',
  'admin_phone_numbers.id used as From for client/referrer activation SMS (prefer Lecca 949-736-5644)'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Seed Lecca OFG number when present in inventory
UPDATE `system_settings` ss
INNER JOIN `admin_phone_numbers` apn
  ON REPLACE(REPLACE(REPLACE(apn.e164, '+', ''), '-', ''), ' ', '') LIKE '%9497365644%'
  AND apn.is_active = 1
SET ss.setting_value = CAST(apn.id AS CHAR)
WHERE ss.setting_key = 'signup_notify_sms_from_phone_number_id'
  AND (ss.setting_value IS NULL OR ss.setting_value = '');
