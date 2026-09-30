-- Backfill client_round_reports.pdf_* from round_report_pdfs (wizard publish source of truth).
-- Older publishes left legacy columns NULL, so MCP get_progress_report showed has_pdf=false
-- even when the branded PDF existed in round_report_pdfs.

UPDATE client_round_reports crr
INNER JOIN round_report_pdfs rrp ON rrp.round_report_id = crr.id
SET crr.pdf_storage_key = rrp.storage_key,
    crr.pdf_file_name = rrp.file_name,
    crr.pdf_storage_provider = rrp.storage_provider,
    crr.pdf_encrypted = rrp.encrypted,
    crr.pdf_enc_iv = rrp.enc_iv,
    crr.pdf_enc_tag = rrp.enc_tag,
    crr.pdf_uploaded_at = COALESCE(crr.pdf_uploaded_at, rrp.uploaded_at)
WHERE crr.pdf_storage_key IS NULL;

UPDATE client_round_reports crr
INNER JOIN round_report_pdfs rrp
  ON rrp.client_id = crr.client_id AND rrp.round_number = crr.round_number
SET crr.pdf_storage_key = rrp.storage_key,
    crr.pdf_file_name = rrp.file_name,
    crr.pdf_storage_provider = rrp.storage_provider,
    crr.pdf_encrypted = rrp.encrypted,
    crr.pdf_enc_iv = rrp.enc_iv,
    crr.pdf_enc_tag = rrp.enc_tag,
    crr.pdf_uploaded_at = COALESCE(crr.pdf_uploaded_at, rrp.uploaded_at)
WHERE crr.pdf_storage_key IS NULL;
