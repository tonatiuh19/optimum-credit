-- ============================================================================
-- Add PDF attachment columns to client_round_reports
-- Admins can upload CRC-generated PDF reports per dispute round.
-- The PDF is encrypted (AES-256-GCM) and stored on the CDN.
-- ============================================================================

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_file_name`        VARCHAR(255)        DEFAULT NULL         AFTER `pdf_storage_key`;

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_storage_provider` ENUM('local','cdn') DEFAULT 'cdn'        AFTER `pdf_file_name`;

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_encrypted`        TINYINT(1) NOT NULL DEFAULT 0            AFTER `pdf_storage_provider`;

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_enc_iv`           CHAR(32)            DEFAULT NULL         AFTER `pdf_encrypted`;

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_enc_tag`          CHAR(32)            DEFAULT NULL         AFTER `pdf_enc_iv`;

ALTER TABLE `client_round_reports`
  ADD COLUMN `pdf_uploaded_at`      DATETIME            DEFAULT NULL         AFTER `pdf_enc_tag`;
