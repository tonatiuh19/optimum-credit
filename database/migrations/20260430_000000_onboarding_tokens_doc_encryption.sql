-- Migration: 20260430_000000_onboarding_tokens_doc_encryption
-- Adds:
--   1. onboarding_tokens   — single-use magic link tokens sent in the welcome email
--   2. client_documents.enc_iv / enc_tag — AES-256-GCM encryption metadata per file

-- ============================================================================
-- 1. ONBOARDING TOKENS (magic link after payment)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `onboarding_tokens` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`    INT UNSIGNED NOT NULL,
  `token_hash`   CHAR(64)     NOT NULL UNIQUE COMMENT 'SHA-256 of the raw token',
  `expires_at`   DATETIME     NOT NULL,
  `consumed_at`  DATETIME     DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_onboarding_tokens_client`  (`client_id`),
  KEY `idx_onboarding_tokens_expires` (`expires_at`),
  CONSTRAINT `fk_onboarding_tokens_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. ADD ENCRYPTION COLUMNS TO client_documents
-- ============================================================================
-- enc_iv  : AES-256-GCM initialisation vector (16 bytes → 32 hex chars)
-- enc_tag : GCM authentication tag           (16 bytes → 32 hex chars)
ALTER TABLE `client_documents`
  ADD COLUMN `enc_iv`  CHAR(32) DEFAULT NULL AFTER `encrypted`,
  ADD COLUMN `enc_tag` CHAR(32) DEFAULT NULL AFTER `enc_iv`;
