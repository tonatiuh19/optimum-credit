-- Allow WhatsApp threads on conversations (messages.channel already includes whatsapp).
-- 360dialog Cloud API inbound/outbound; assignee via WHATSAPP_ASSIGNED_ADMIN_ID or César profile phone.

ALTER TABLE `conversations`
  MODIFY COLUMN `channel` ENUM('sms','call','email','internal','whatsapp') NOT NULL DEFAULT 'sms';
