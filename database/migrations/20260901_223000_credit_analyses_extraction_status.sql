-- Persist extraction metadata so re-loaded analyses match live submit responses.
ALTER TABLE `credit_analyses`
  ADD COLUMN `extraction_status` ENUM('ok','empty','parse_failed','unsupported_type') DEFAULT NULL
    AFTER `provider_detected`;

ALTER TABLE `credit_analyses`
  ADD COLUMN `chars_extracted` INT UNSIGNED NOT NULL DEFAULT 0
    AFTER `extraction_status`;
