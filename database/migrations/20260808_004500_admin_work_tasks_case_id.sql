-- Link admin Work Hub tasks to credit repair cases (optional).
-- TiDB / MySQL 8 compatible (split ALTER — TiDB rejects combined ADD COLUMN+KEY).

ALTER TABLE `admin_work_tasks`
  ADD COLUMN `case_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Optional link to credit_repair_cases.id'
    AFTER `assignee_admin_id`;

ALTER TABLE `admin_work_tasks`
  ADD KEY `idx_work_tasks_case` (`case_id`);

ALTER TABLE `admin_work_tasks`
  ADD CONSTRAINT `fk_work_tasks_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`)
    ON DELETE SET NULL;
