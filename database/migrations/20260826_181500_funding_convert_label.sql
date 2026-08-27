-- Seed source label for Funding → Prospect convert
INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`)
VALUES (
  'funding_convert',
  'Converted from funding',
  'Convertido desde funding',
  'source',
  'accent',
  1,
  55
)
ON DUPLICATE KEY UPDATE
  `name_en` = VALUES(`name_en`),
  `name_es` = VALUES(`name_es`),
  `is_system` = 1;
