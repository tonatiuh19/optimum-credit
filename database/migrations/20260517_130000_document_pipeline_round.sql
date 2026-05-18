-- Add pipeline_round to client_documents so admins can tag a document
-- with the pipeline stage/round it belongs to (e.g. round_1, round_2, …).
ALTER TABLE `client_documents`
  ADD COLUMN `pipeline_round` VARCHAR(30) DEFAULT NULL
    COMMENT 'Pipeline stage this document is linked to (e.g. round_1)'
    AFTER `doc_type`;
