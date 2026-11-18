-- Client care items follow their conversation: deleting a conversation removes its items
-- (test runs deleted conversations and left orphaned items behind). Nov 18, 2026.
DELETE i FROM client_care_items i LEFT JOIN conversations c ON c.id = i.conversation_id WHERE c.id IS NULL;
ALTER TABLE client_care_items
  ADD CONSTRAINT fk_cci_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
