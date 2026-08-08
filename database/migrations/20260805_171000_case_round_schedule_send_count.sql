-- Track how many times the .ics was emailed so SEQUENCE can bump on updates.
ALTER TABLE `case_round_schedules`
  ADD COLUMN `calendar_send_count` INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Number of successful calendar email sends (drives ICS SEQUENCE)'
    AFTER `last_sent_recipients`;
