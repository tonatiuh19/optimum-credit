-- Short-lived multi-use tokens for secure Round PDF download links (email/SMS).
-- Tokens expire; same link works in both email and SMS until expiry.

CREATE TABLE IF NOT EXISTS `round_report_download_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` CHAR(64) NOT NULL,
  `pdf_id` INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` DATETIME DEFAULT NULL,
  `use_count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rrdt_token_hash` (`token_hash`),
  KEY `idx_rrdt_expires` (`expires_at`),
  KEY `idx_rrdt_pdf` (`pdf_id`),
  KEY `idx_rrdt_client` (`client_id`),
  CONSTRAINT `fk_rrdt_pdf` FOREIGN KEY (`pdf_id`)
    REFERENCES `round_report_pdfs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rrdt_client` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
