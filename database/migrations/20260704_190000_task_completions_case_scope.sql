-- Scope onboarding task completions to credit_repair_cases (not client alone).
-- 1) Backfill case_id on existing rows
-- 2) Cancel duplicate active cases (keep package + newest)
-- 3) Enforce unique (case_id, task_template_id)

ALTER TABLE `client_task_completions`
  ADD COLUMN IF NOT EXISTS `case_id` INT UNSIGNED NULL AFTER `client_id`;

-- Primary case per client: active with package preferred, else newest active, else newest any
UPDATE `client_task_completions` ctc
JOIN (
  SELECT cr.client_id,
    CAST(
      SUBSTRING_INDEX(
        GROUP_CONCAT(
          cr.id
          ORDER BY (cr.status = 'active') DESC, (cr.package_id IS NOT NULL) DESC, cr.id DESC
        ),
        ',',
        1
      ) AS UNSIGNED
    ) AS case_id
  FROM `credit_repair_cases` cr
  GROUP BY cr.client_id
) pk ON pk.client_id = ctc.client_id
SET ctc.case_id = pk.case_id
WHERE ctc.case_id IS NULL;

-- Cancel duplicate active cases (keep one per client)
UPDATE `credit_repair_cases` cr
JOIN (
  SELECT client_id,
    CAST(
      SUBSTRING_INDEX(
        GROUP_CONCAT(id ORDER BY (package_id IS NOT NULL) DESC, id DESC),
        ',',
        1
      ) AS UNSIGNED
    ) AS keep_id
  FROM `credit_repair_cases`
  WHERE status = 'active'
  GROUP BY client_id
) k ON k.client_id = cr.client_id
SET cr.status = 'cancelled',
    cr.notes = CONCAT(
      COALESCE(CONCAT(cr.notes, ' | '), ''),
      'Auto-cancelled duplicate active case (migration 20260704).'
    )
WHERE cr.status = 'active'
  AND cr.id != k.keep_id;

ALTER TABLE `client_task_completions`
  MODIFY `case_id` INT UNSIGNED NOT NULL;

ALTER TABLE `client_task_completions`
  DROP INDEX `uq_client_task`;

ALTER TABLE `client_task_completions`
  ADD UNIQUE KEY `uq_case_task` (`case_id`, `task_template_id`);

ALTER TABLE `client_task_completions`
  ADD KEY IF NOT EXISTS `idx_ctc_case` (`case_id`);

ALTER TABLE `client_task_completions`
  ADD CONSTRAINT `fk_ctc_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE;
