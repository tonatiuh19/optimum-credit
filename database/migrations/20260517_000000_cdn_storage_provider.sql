-- Add 'cdn' as a valid storage provider for client_documents.
-- Files uploaded via the Disrupting Labs CDN (uploadFiles.php) use this provider.
-- storage_key will hold the full public CDN URL when provider = 'cdn'.
-- Existing 'local' rows are unaffected.

ALTER TABLE `client_documents`
  MODIFY COLUMN `storage_provider` ENUM('local','s3','r2','cdn') NOT NULL DEFAULT 'local';
