-- Funding underwriter role (outside underwriting partner): funding board
-- only — documents, stage moves, notes, doc requests/uploads. Everything
-- else is denied centrally in the admin auth guard.
ALTER TABLE admins
  MODIFY COLUMN `role` ENUM('super_admin','admin','agent','affiliate','underwriter') NOT NULL DEFAULT 'admin';

-- Audit trail for sensitive funding data (document views/downloads/uploads,
-- SSN/EIN reveals, doc requests).
CREATE TABLE IF NOT EXISTS funding_access_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NOT NULL,
  funding_application_id INT UNSIGNED NOT NULL,
  action ENUM('view_doc','upload_doc','request_doc','reveal_ssn','reveal_ein','status_change','note') NOT NULL,
  document_id INT UNSIGNED DEFAULT NULL,
  detail VARCHAR(255) DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_funding_access_app (funding_application_id, created_at),
  KEY idx_funding_access_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
