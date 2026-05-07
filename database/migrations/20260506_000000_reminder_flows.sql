-- ============================================================================
-- Reminder Flows — per-pipeline-stage automated email sequences
-- Trigger events map to key points in the client journey:
--   payment_confirmed → client enters new_client stage (Day 1/2/3 emails)
--   round_N_complete  → admin creates a round report for that round
--   completed         → client stage set to completed
-- ============================================================================

-- ── reminder_flows ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `reminder_flows` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(150) NOT NULL,
  `description`   TEXT DEFAULT NULL,
  `trigger_event` ENUM(
    'payment_confirmed',
    'docs_ready',
    'round_1_complete',
    'round_2_complete',
    'round_3_complete',
    'round_4_complete',
    'round_5_complete',
    'completed'
  ) NOT NULL,
  `is_active`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reminder_flows_trigger` (`trigger_event`),
  KEY `idx_reminder_flows_active`  (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── reminder_flow_steps ──────────────────────────────────────────────────────
-- Each step has a delay_days (days after trigger to execute).
-- step_type = send_email → uses template_slug OR custom subject+body
-- step_type = internal_alert → inserts an internal notification for the team
CREATE TABLE IF NOT EXISTS `reminder_flow_steps` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id`       INT UNSIGNED NOT NULL,
  `step_order`    INT NOT NULL DEFAULT 0,
  `step_type`     ENUM('send_email','internal_alert') NOT NULL DEFAULT 'send_email',
  `delay_days`    INT NOT NULL DEFAULT 0,
  `label`         VARCHAR(150) DEFAULT NULL,
  `subject`       VARCHAR(255) DEFAULT NULL,
  `body`          MEDIUMTEXT DEFAULT NULL,
  `template_slug` VARCHAR(100) DEFAULT NULL COMMENT 'References communication_templates.slug',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_flow_steps_flow`  (`flow_id`),
  KEY `idx_flow_steps_order` (`step_order`),
  CONSTRAINT `fk_flow_steps_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── reminder_flow_executions ─────────────────────────────────────────────────
-- One row per (flow, client) trigger event. Used for history / audit.
CREATE TABLE IF NOT EXISTS `reminder_flow_executions` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id`          INT UNSIGNED NOT NULL,
  `client_id`        INT UNSIGNED NOT NULL,
  `triggered_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`           ENUM('completed','partial','failed') NOT NULL DEFAULT 'completed',
  `steps_executed`   INT UNSIGNED NOT NULL DEFAULT 0,
  `steps_scheduled`  INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message`    TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_flow_exec_flow`      (`flow_id`),
  KEY `idx_flow_exec_client`    (`client_id`),
  KEY `idx_flow_exec_triggered` (`triggered_at`),
  CONSTRAINT `fk_flow_exec_flow`   FOREIGN KEY (`flow_id`)   REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_flow_exec_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`)         ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Email templates for each flow trigger (stored in communication_templates)
-- ============================================================================
INSERT INTO `communication_templates`
  (`slug`, `name`, `channel`, `subject`, `body`, `variables_json`)
VALUES
  (
    'flow_new_client_day1',
    '[Flow] New Client — Day 1 Welcome',
    'email',
    'Welcome to Optimum Credit, {{first_name}}! Upload your documents to start.',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Welcome aboard, {{first_name}}!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your payment is confirmed and we are thrilled to start working on your credit repair journey. The first step is to upload your required documents so our team can begin right away.</p>
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">Documents needed:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#334155;line-height:1.8;">
  <li>Government-issued ID (front &amp; back)</li>
  <li>Social Security Card</li>
  <li>Proof of Address (utility bill or bank statement)</li>
</ul>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">It only takes a few minutes — click the button below to upload from your secure portal.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),
  (
    'flow_new_client_day2',
    '[Flow] New Client — Day 2 Reminder',
    'email',
    'Reminder: We are waiting for your documents, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">We are waiting for your documents</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, just a friendly reminder — we have not received your documents yet. Your credit repair process cannot begin until we do.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Uploading takes only a few minutes. We are here and ready to start working for you as soon as your documents arrive.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),
  (
    'flow_new_client_day3',
    '[Flow] New Client — Day 3 Final Reminder',
    'email',
    'Final reminder: Please upload your documents today, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Action needed: upload your documents today</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, this is your final reminder to upload your documents. Please do so today so we can begin working on your credit repair immediately.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">If you are having trouble or need assistance, please reply to this email or open a support ticket from your portal — our team is here to help.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),
  (
    'flow_round_1_complete',
    '[Flow] Round 1 Progress Report',
    'email',
    'Your Round 1 progress report is ready, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Round 1 is complete!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, great news — Round 1 of your credit repair cycle is complete. We have been working hard disputing inaccurate items on your credit report and your monthly progress report is now ready.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Log in to your portal to view the full report including items disputed, items removed, and your updated credit score.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),
  (
    'flow_round_2_complete',
    '[Flow] Round 2 Progress Report',
    'email',
    'Your Round 2 progress report is ready, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Round 2 is complete!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, Round 2 of your credit repair is complete. We are continuing to make progress on your behalf. Check your latest report in the portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),
  (
    'flow_round_3_complete',
    '[Flow] Round 3 Progress Report',
    'email',
    'Your Round 3 progress report is ready, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Round 3 is complete — you are more than halfway there!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, Round 3 of your credit repair is complete. You are more than halfway through your program. View your latest progress report in your portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),
  (
    'flow_round_4_complete',
    '[Flow] Round 4 Progress Report',
    'email',
    'Your Round 4 progress report is ready, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Round 4 is complete — one more to go!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, Round 4 of your credit repair is complete. You are almost there! View your progress report in your portal and get ready for the final round.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),
  (
    'flow_round_5_complete',
    '[Flow] Round 5 Final Report',
    'email',
    'Your final progress report is ready, {{first_name}}!',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Round 5 — your final report is ready!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, Round 5 of your credit repair is complete! This is your final monthly report summarizing everything we have accomplished together. View the full summary in your portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),
  (
    'flow_completed',
    '[Flow] Credit Repair Complete',
    'email',
    'Your credit repair journey is complete, {{first_name}}!',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Congratulations, {{first_name}}!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your credit repair process is officially complete. Thank you for trusting Optimum Credit Repair with your financial journey. We are proud of the progress we have made together.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your final report and all your documents are available in your portal. We recommend continuing to monitor your credit score and reaching out if you need assistance in the future.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  )
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- ============================================================================
-- Default reminder flows
-- ============================================================================
INSERT INTO `reminder_flows` (`name`, `description`, `trigger_event`, `is_active`)
VALUES
  (
    'New Client Welcome Sequence',
    'Three-day email sequence sent to new clients after payment to encourage document upload. Day 3+ triggers an internal team alert if no docs received.',
    'payment_confirmed',
    1
  ),
  (
    'Round 1 Complete Notification',
    'Send a progress report email to the client when Round 1 is marked complete.',
    'round_1_complete',
    1
  ),
  (
    'Round 2 Complete Notification',
    'Send a progress report email to the client when Round 2 is marked complete.',
    'round_2_complete',
    1
  ),
  (
    'Round 3 Complete Notification',
    'Send a progress report email to the client when Round 3 is marked complete.',
    'round_3_complete',
    1
  ),
  (
    'Round 4 Complete Notification',
    'Send a progress report email to the client when Round 4 is marked complete.',
    'round_4_complete',
    1
  ),
  (
    'Round 5 Final Report',
    'Send the final progress report email to the client when Round 5 is marked complete.',
    'round_5_complete',
    1
  ),
  (
    'Credit Repair Completed',
    'Send a completion congratulations email when the client reaches the Completed stage.',
    'completed',
    1
  );

-- ============================================================================
-- Default steps for each flow
-- We use subqueries to get flow IDs since AUTO_INCREMENT values are not known
-- ============================================================================

-- Flow: New Client Welcome Sequence (payment_confirmed)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Day 1 — Welcome & Upload Request', 'flow_new_client_day1'
FROM `reminder_flows` WHERE `trigger_event` = 'payment_confirmed' LIMIT 1;

INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 2, 'send_email', 1, 'Day 2 — Upload Reminder', 'flow_new_client_day2'
FROM `reminder_flows` WHERE `trigger_event` = 'payment_confirmed' LIMIT 1;

INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 3, 'send_email', 2, 'Day 3 — Final Reminder', 'flow_new_client_day3'
FROM `reminder_flows` WHERE `trigger_event` = 'payment_confirmed' LIMIT 1;

INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `subject`, `body`)
SELECT id, 4, 'internal_alert', 3, 'Day 3+ — Team Alert (No Docs)', 'Follow-up Required: Client Has Not Uploaded Documents',
  'Client {{first_name}} {{last_name}} has not uploaded their documents after 3 days. Please begin manual follow-up via call or email from the CRM.'
FROM `reminder_flows` WHERE `trigger_event` = 'payment_confirmed' LIMIT 1;

-- Flow: Round 1 Complete (round_1_complete)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Round 1 Progress Report Email', 'flow_round_1_complete'
FROM `reminder_flows` WHERE `trigger_event` = 'round_1_complete' LIMIT 1;

-- Flow: Round 2 Complete (round_2_complete)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Round 2 Progress Report Email', 'flow_round_2_complete'
FROM `reminder_flows` WHERE `trigger_event` = 'round_2_complete' LIMIT 1;

-- Flow: Round 3 Complete (round_3_complete)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Round 3 Progress Report Email', 'flow_round_3_complete'
FROM `reminder_flows` WHERE `trigger_event` = 'round_3_complete' LIMIT 1;

-- Flow: Round 4 Complete (round_4_complete)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Round 4 Progress Report Email', 'flow_round_4_complete'
FROM `reminder_flows` WHERE `trigger_event` = 'round_4_complete' LIMIT 1;

-- Flow: Round 5 Complete (round_5_complete)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Round 5 Final Report Email', 'flow_round_5_complete'
FROM `reminder_flows` WHERE `trigger_event` = 'round_5_complete' LIMIT 1;

-- Flow: Completed (completed)
INSERT INTO `reminder_flow_steps` (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT id, 1, 'send_email', 0, 'Credit Repair Completion Email', 'flow_completed'
FROM `reminder_flows` WHERE `trigger_event` = 'completed' LIMIT 1;
