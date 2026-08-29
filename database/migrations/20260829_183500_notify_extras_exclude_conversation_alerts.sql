-- Extra notify inboxes (support/lino/angel) had events_json NULL = ALL events,
-- so every inbound SMS / missed call / voicemail emailed the whole ops list.
-- Scope them to team ops alerts; line owners still get conversation alerts via
-- their staff prefs. Joe Pepe funding-only row unchanged.
-- TiDB / MySQL 8 compatible.

UPDATE admin_notify_extra_emails
SET events_json = JSON_ARRAY(
  'purchase_enrollment',
  'payment_installment',
  'submission_ready_review',
  'submission_doc_upload',
  'submission_info_request',
  'doc_upload_link',
  'round_calendar',
  'work_task_assigned',
  'work_task_overdue',
  'funding_doc_upload',
  'funding_application_created',
  'progress_report_alerts'
)
WHERE email IN (
  'support@optimum-financial-group.com',
  'lino@optimum-financial-group.com',
  'angel@optimum-financial-group.com'
)
AND (
  events_json IS NULL
  OR JSON_CONTAINS(
    events_json,
    JSON_QUOTE('inbound_sms')
  )
  OR JSON_CONTAINS(
    events_json,
    JSON_QUOTE('missed_call')
  )
);
