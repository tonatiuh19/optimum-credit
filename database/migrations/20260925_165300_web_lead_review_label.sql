-- Web-lead review bucket: public form spam stays off main Prospect until staff promotes.
INSERT INTO `labels` (`slug`, `name_en`, `name_es`, `layer`, `color`, `is_system`, `sort_order`)
VALUES
  ('web_lead_review', 'Web lead (review)', 'Lead web (revisar)', 'source', 'secondary', 1, 15)
ON DUPLICATE KEY UPDATE
  `name_en` = VALUES(`name_en`),
  `name_es` = VALUES(`name_es`),
  `sort_order` = VALUES(`sort_order`);

-- Tag existing public-form prospects still on Prospect so they move to the review bucket.
INSERT IGNORE INTO `client_labels` (`client_id`, `label_id`)
SELECT c.id, l.id
FROM clients c
CROSS JOIN labels l
WHERE l.slug = 'web_lead_review'
  AND c.status <> 'cancelled'
  AND c.status <> 'funding'
  AND (c.status = 'prospect' OR c.pipeline_stage = 'prospect')
  AND NOT EXISTS (
    SELECT 1 FROM credit_repair_cases cr
    WHERE cr.client_id = c.id
      AND cr.status = 'active'
      AND cr.pipeline_stage <> 'prospect'
  )
  AND EXISTS (
    SELECT 1 FROM client_labels cl
    JOIN labels ls ON ls.id = cl.label_id
    WHERE cl.client_id = c.id
      AND ls.slug IN ('web_analysis', 'get_started_wizard', 'get_credit_report')
  );
