-- Per-event filters for extra notify emails (null = all events).
ALTER TABLE `admin_notify_extra_emails`
  ADD COLUMN `events_json` JSON DEFAULT NULL
    COMMENT 'NULL = all events; else JSON array of AdminNotifyEventKey'
  AFTER `is_active`;
