-- Conversations hub is SMS + internal notes only; email will be a separate module.
-- Soft-disable any email conversation templates (ENUM value retained for history).

UPDATE `conversation_templates`
SET `is_active` = 0
WHERE `channel` = 'email' AND `is_active` = 1;
