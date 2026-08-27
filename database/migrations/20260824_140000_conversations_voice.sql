-- Voice calling: admin softphone settings + org voicemail defaults
-- TiDB: add columns one at a time (multi-ADD with AFTER newly-added cols fails)

ALTER TABLE `admins`
  ADD COLUMN `voice_available` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Browser softphone registered for inbound on assigned OFG line'
    AFTER `notification_prefs_json`;

ALTER TABLE `admins`
  ADD COLUMN `call_forwarding_enabled` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Also ring personal phone on inbound'
    AFTER `voice_available`;

ALTER TABLE `admins`
  ADD COLUMN `call_forwarding_phone` VARCHAR(20) DEFAULT NULL
    COMMENT 'E.164 cell for simultaneous ring'
    AFTER `call_forwarding_enabled`;

ALTER TABLE `admins`
  ADD COLUMN `voicemail_enabled` TINYINT(1) DEFAULT NULL
    COMMENT 'NULL = inherit org default from system_settings'
    AFTER `call_forwarding_phone`;

ALTER TABLE `admins`
  ADD COLUMN `voicemail_greeting_text` TEXT DEFAULT NULL
    AFTER `voicemail_enabled`;

ALTER TABLE `admins`
  ADD COLUMN `voicemail_greeting_url` VARCHAR(500) DEFAULT NULL
    AFTER `voicemail_greeting_text`;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES
  ('voice_voicemail_enabled', '1', 'Org default: enable voicemail on assigned OFG lines when admin has no override'),
  ('voice_voicemail_greeting_text', 'Hello, you have reached Optimum Credit. We are unable to take your call right now. Please leave a message after the tone.', 'Default TTS voicemail greeting'),
  ('voice_voicemail_max_seconds', '120', 'Max voicemail recording seconds'),
  ('voice_voicemail_transcribe', '1', 'Request Twilio transcription for voicemails')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
