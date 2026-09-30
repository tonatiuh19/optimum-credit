-- Progress-report compare mode (baseline vs chain) + extended-round calendar dates.
-- Baseline (default): Round N Before = enrollment / Round 1 Before PDF.
-- Chain: Round N Before = prior round After (legacy).

ALTER TABLE `credit_repair_cases`
  ADD COLUMN `report_compare_mode` ENUM('baseline','chain') NOT NULL DEFAULT 'baseline'
    COMMENT 'baseline=vs enrollment; chain=vs prior After'
    AFTER `next_dispute_target_date`;

-- Optional explicit dates for rounds 6..12 (JSON object: {"6":"YYYY-MM-DD",...}).
-- When absent, calendar projects from round_5_date + interval_days.
ALTER TABLE `case_round_schedules`
  ADD COLUMN `extended_dates_json` JSON DEFAULT NULL
    COMMENT 'Optional target dates for rounds 6+ as {"6":"YYYY-MM-DD",...}'
    AFTER `round_5_date`;

-- Reminder ENUM: one shared trigger for any published round beyond 5.
ALTER TABLE `reminder_flows`
  MODIFY COLUMN `trigger_event` ENUM(
    'payment_confirmed',
    'docs_ready',
    'round_1_complete',
    'round_2_complete',
    'round_3_complete',
    'round_4_complete',
    'round_5_complete',
    'round_extended_complete',
    'completed',
    'payment_due'
  ) NOT NULL;

INSERT INTO `communication_templates`
  (`slug`,`name`,`channel`,`subject`,`body`,`variables_json`)
VALUES
  (
    'flow_round_extended_complete',
    '[Flow] Round 6+ Progress Report',
    'email',
    'Your Round {{round_number}} progress report is ready, {{first_name}}',
    '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}}, Round {{round_number}} of your credit repair is complete. View your latest progress report in your portal.</p><p style="margin:0 0 8px;"><a href="{{portal_url}}" style="color:#0D1F3C;font-weight:600;">Open portal reports</a></p>',
    JSON_ARRAY('first_name','portal_url','items_removed','score_change','round_number')
  ),
  (
    'flow_round_extended_complete_es',
    '[Flow] Informe de Progreso Ronda 6+ (ES)',
    'email',
    'Tu informe de progreso de la Ronda {{round_number}} está listo, {{first_name}}',
    '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, la Ronda {{round_number}} de tu reparación de crédito está completa. Revisa tu informe de progreso en el portal.</p><p style="margin:0 0 8px;"><a href="{{portal_url}}" style="color:#0D1F3C;font-weight:600;">Abrir informes del portal</a></p>',
    JSON_ARRAY('first_name','portal_url','items_removed','score_change','round_number')
  )
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `subject` = VALUES(`subject`),
  `body` = VALUES(`body`),
  `variables_json` = VALUES(`variables_json`);

INSERT INTO `reminder_flows`
  (`name`, `description`, `trigger_event`, `is_active`)
SELECT
  'Round 6+ Progress Report',
  'Fires when staff publish an OFG progress report for round 6 or higher (extended cases).',
  'round_extended_complete',
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `reminder_flows` WHERE `trigger_event` = 'round_extended_complete' LIMIT 1
);

INSERT INTO `reminder_flow_steps`
  (`flow_id`, `step_order`, `step_type`, `delay_days`, `label`, `template_slug`)
SELECT f.id, 1, 'send_email', 0, 'Round 6+ Progress Report Email', 'flow_round_extended_complete'
FROM `reminder_flows` f
WHERE f.trigger_event = 'round_extended_complete'
  AND NOT EXISTS (
    SELECT 1 FROM `reminder_flow_steps` s WHERE s.flow_id = f.id LIMIT 1
  )
LIMIT 1;
