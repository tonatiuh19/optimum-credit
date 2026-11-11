-- Facebook Messenger + Instagram DMs in Conversations (Nov 10, 2026).
-- Social senders reuse conversation_unknown_contacts (phone NULL, Meta id set);
-- linking one to a client keeps the identity on that row (status 'linked').
-- TiDB Cloud Serverless (MySQL 8.0 compatible). Additive only.

ALTER TABLE `conversations`
  MODIFY COLUMN `channel` ENUM('sms','call','email','internal','whatsapp','messenger','instagram') NOT NULL DEFAULT 'sms';

ALTER TABLE `conversation_messages`
  MODIFY COLUMN `channel` ENUM('sms','call','email','internal','whatsapp','messenger','instagram') NOT NULL DEFAULT 'sms';

ALTER TABLE `conversation_unknown_contacts`
  ADD COLUMN `social_platform` ENUM('messenger','instagram') DEFAULT NULL
    COMMENT 'Set for Facebook / Instagram senders (no phone)',
  ADD COLUMN `social_user_id` VARCHAR(64) DEFAULT NULL
    COMMENT 'Page-scoped id (PSID) or Instagram-scoped id (IGSID)',
  ADD COLUMN `social_page_id` VARCHAR(64) DEFAULT NULL
    COMMENT 'Facebook Page / Instagram account that received the DM',
  ADD COLUMN `social_username` VARCHAR(100) DEFAULT NULL,
  ADD COLUMN `social_last_inbound_at` DATETIME DEFAULT NULL
    COMMENT 'Meta reply window: 24h standard, 7 days with HUMAN_AGENT tag';

ALTER TABLE `conversation_unknown_contacts`
  ADD UNIQUE KEY `uq_unknown_social_identity` (`social_platform`, `social_user_id`);
