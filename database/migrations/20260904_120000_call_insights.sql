-- Call insights: async transcript + Claude resume for answered calls & voicemails
ALTER TABLE `conversation_messages`
  ADD COLUMN `call_insights_status` ENUM(
    'pending',
    'processing',
    'ready',
    'failed',
    'skipped'
  ) NULL DEFAULT NULL
    COMMENT 'Async call insights pipeline status';

ALTER TABLE `conversation_messages`
  ADD COLUMN `call_transcript` MEDIUMTEXT NULL DEFAULT NULL
    COMMENT 'STT transcript (Twilio voicemail or Whisper)';

ALTER TABLE `conversation_messages`
  ADD COLUMN `call_insights_json` JSON NULL DEFAULT NULL
    COMMENT 'Claude resume: summary, sentiment, topics, actions, risks';

ALTER TABLE `conversation_messages`
  ADD COLUMN `call_insights_error` VARCHAR(500) NULL DEFAULT NULL;

ALTER TABLE `conversation_messages`
  ADD COLUMN `call_insights_updated_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `conversation_messages`
  ADD KEY `idx_messages_call_insights` (`channel`, `call_insights_status`);
