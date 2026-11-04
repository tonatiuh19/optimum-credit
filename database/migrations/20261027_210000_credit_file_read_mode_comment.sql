-- read_mode gains 'split_fallback' (a split read did not verify, so the one-pass read was paid too).
-- Comment-only change; the column stays VARCHAR(16). TiDB Cloud Serverless (MySQL 8.0 compatible).
ALTER TABLE `credit_file_extractions`
  MODIFY COLUMN `read_mode` VARCHAR(16) DEFAULT NULL COMMENT 'direct | chunked | batch | reused | split_fallback';
