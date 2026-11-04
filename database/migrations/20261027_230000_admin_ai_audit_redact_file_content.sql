-- Redact file contents (base64) already stored in admin_ai_audit_logs.context_json.
-- New rows are redacted in code (redactAdminAiAuditPayload); this cleans history.
-- Keeps size + sha256 so each upload stays traceable. Idempotent: only touches
-- values that are still strings.

UPDATE admin_ai_audit_logs
SET context_json = JSON_SET(
  context_json,
  '$.args.file_base64',
  JSON_OBJECT(
    'redacted', 'file_content',
    'chars', CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.file_base64'))),
    'sha256', SHA2(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.file_base64')), 256)
  )
)
WHERE JSON_TYPE(JSON_EXTRACT(context_json, '$.args.file_base64')) = 'STRING'
  AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.file_base64'))) > 0;

UPDATE admin_ai_audit_logs
SET context_json = JSON_SET(
  context_json,
  '$.args.attachment_base64',
  JSON_OBJECT(
    'redacted', 'file_content',
    'chars', CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.attachment_base64'))),
    'sha256', SHA2(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.attachment_base64')), 256)
  )
)
WHERE JSON_TYPE(JSON_EXTRACT(context_json, '$.args.attachment_base64')) = 'STRING'
  AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.args.attachment_base64'))) > 0;
