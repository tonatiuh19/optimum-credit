-- System close/reopen timeline events + align direction with hub notes.
-- TiDB: one ALTER per statement.

ALTER TABLE `conversation_messages`
  MODIFY COLUMN `direction` ENUM('inbound','outbound','internal','system') NOT NULL;
