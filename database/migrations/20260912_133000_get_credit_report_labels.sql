-- Source labels for /get-credit-report prospect capture + Sep 2026 event tags.
INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`) VALUES
  ('get_credit_report', 'Get credit report', 'Obtener reporte de crédito', 'source', 'primary', 1, 25),
  ('golf_tournament_prospect', 'Golf tournament prospect', 'Prospecto torneo de golf', 'source', 'accent', 1, 26),
  ('las_vegas_event', 'Las Vegas Event', 'Evento Las Vegas', 'source', 'accent', 1, 27)
ON DUPLICATE KEY UPDATE
  `name_en` = VALUES(`name_en`),
  `name_es` = VALUES(`name_es`),
  `layer` = VALUES(`layer`),
  `color` = VALUES(`color`),
  `is_system` = VALUES(`is_system`),
  `sort_order` = VALUES(`sort_order`);
