-- Out of office: the away person's own auto-reply text (Nov 18, 2026, Cesar).
-- While set and the line owner is away, clients texting / calling that line get this exact
-- text (English or Spanish by the client's language) instead of the client care template.
-- TiDB Cloud Serverless (MySQL 8.0 compatible). Additive only.

ALTER TABLE `admin_out_of_office`
  ADD COLUMN `auto_reply_en` VARCHAR(320) DEFAULT NULL
    COMMENT 'Exact auto-reply for English clients on this person''s line while away',
  ADD COLUMN `auto_reply_es` VARCHAR(320) DEFAULT NULL
    COMMENT 'Exact auto-reply for Spanish clients on this person''s line while away';
