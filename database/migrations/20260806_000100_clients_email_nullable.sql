-- Make clients.email optional so staff can add phone-only leads.
-- MySQL/TiDB UNIQUE allows multiple NULL values; empty string is still unique-constrained.
-- Applied for: email-optional create client + safe skip of outbound client emails.

ALTER TABLE `clients`
  MODIFY COLUMN `email` VARCHAR(255) DEFAULT NULL;

-- Normalize accidental empty strings to NULL so UNIQUE works as intended.
UPDATE `clients` SET `email` = NULL WHERE `email` = '';
