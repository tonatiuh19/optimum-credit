-- Client reminder SMS: also text after successful reminder emails (Lecca OFG From).
-- Per-step toggle also_sms (default ON for existing send_email steps).

ALTER TABLE `reminder_flow_steps`
  ADD COLUMN `also_sms` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'When 1 and global client_reminder_sms_enabled, SMS after email succeeds'
    AFTER `template_slug`;

INSERT INTO `system_settings` (`setting_key`, `setting_value`)
VALUES
  ('client_reminder_sms_enabled', '1')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
