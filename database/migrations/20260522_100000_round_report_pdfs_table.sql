-- ============================================================================
-- Create round_report_pdfs table for multiple PDFs per dispute round.
-- Previously, client_round_reports held one pdf per round via pdf_* columns.
-- This table replaces that pattern to support multiple attachments per round.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `round_report_pdfs` (
  `id`                  INT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `client_id`           INT UNSIGNED        NOT NULL,
  `round_number`        TINYINT UNSIGNED    NOT NULL,
  `round_report_id`     INT UNSIGNED        DEFAULT NULL,
  `file_name`           VARCHAR(255)        NOT NULL,
  `storage_key`         VARCHAR(500)        NOT NULL,
  `storage_provider`    ENUM('local','cdn') NOT NULL DEFAULT 'cdn',
  `encrypted`           TINYINT(1)          NOT NULL DEFAULT 0,
  `enc_iv`              CHAR(32)            DEFAULT NULL,
  `enc_tag`             CHAR(32)            DEFAULT NULL,
  `uploaded_by_admin_id` INT UNSIGNED       DEFAULT NULL,
  `uploaded_at`         DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rrp_client_round` (`client_id`, `round_number`),
  INDEX `idx_rrp_round_report` (`round_report_id`),
  CONSTRAINT `fk_rrp_client` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
