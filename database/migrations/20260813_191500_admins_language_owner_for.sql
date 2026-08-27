-- Language ownership is explicit in DB (not preferred_language or hardcoded emails).
-- preferred_language = admin UI/comms preference; language_owner_for = who owns en|es clients/tasks.
-- At most one active owner per language (UNIQUE allows multiple NULLs).

ALTER TABLE `admins`
  ADD COLUMN `language_owner_for` ENUM('en','es') NULL
    COMMENT 'Language-owner role for client/task routing (en|es); NULL = not an owner'
    AFTER `preferred_language`;

ALTER TABLE `admins`
  ADD UNIQUE KEY `uq_admins_language_owner_for` (`language_owner_for`);

-- Seed OFG owners (idempotent): English → Lecca, Spanish → Angel when those rows exist.
UPDATE `admins`
SET `language_owner_for` = 'en'
WHERE LOWER(`email`) = 'lecca@optimum-financial-group.com'
  AND `status` = 'active'
  AND `language_owner_for` IS NULL;

UPDATE `admins`
SET `language_owner_for` = 'es'
WHERE LOWER(`email`) = 'angel@optimum-financial-group.com'
  AND `status` = 'active'
  AND `language_owner_for` IS NULL;

-- Keep Angel's preferred_language aligned with Spanish ownership (comms preference).
UPDATE `admins`
SET `preferred_language` = 'es'
WHERE LOWER(`email`) = 'angel@optimum-financial-group.com'
  AND `preferred_language` <> 'es';
