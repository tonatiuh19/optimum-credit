-- GF-8 Productivity scorecard (OFG): daily / weekly grades per staff profile,
-- days off, badges, Slack identity. System data only.
ALTER TABLE admins ADD COLUMN `productivity_profile` VARCHAR(20) DEFAULT NULL COMMENT 'GF-8 scorecard profile: ops | sales; NULL = not scored';
ALTER TABLE admins ADD COLUMN `slack_user_id` VARCHAR(20) DEFAULT NULL COMMENT 'Slack member id (U...) for scorecard DMs / Slack metrics';

CREATE TABLE IF NOT EXISTS `productivity_days_off` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `day` DATE NOT NULL COMMENT 'America/Los_Angeles calendar day',
  `reason` VARCHAR(120) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_dayoff` (`admin_id`, `day`),
  CONSTRAINT `fk_prod_dayoff_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `productivity_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `score_date` DATE NOT NULL COMMENT 'America/Los_Angeles day',
  `profile` VARCHAR(20) NOT NULL,
  `total` DECIMAL(5,1) DEFAULT NULL COMMENT 'NULL = not graded (day off / nothing pending)',
  `grade` CHAR(1) DEFAULT NULL,
  `level` VARCHAR(10) NOT NULL DEFAULT 'bronze',
  `metrics_json` JSON NOT NULL COMMENT 'Per metric: score, raw, target, weight, locked, graded, evidence ids',
  `final` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = locked at 4:40 PM',
  `slack_sent_at` DATETIME DEFAULT NULL,
  `computed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_score_day` (`admin_id`, `score_date`),
  KEY `idx_prod_score_date` (`score_date`),
  CONSTRAINT `fk_prod_score_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `productivity_badges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `badge_key` VARCHAR(40) NOT NULL,
  `earned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_badge` (`admin_id`, `badge_key`),
  CONSTRAINT `fk_prod_badge_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE admins SET productivity_profile = 'ops', slack_user_id = 'U0C6CHP1BLM' WHERE id = 150002;
UPDATE admins SET productivity_profile = 'sales', slack_user_id = 'U0C7FAKV132' WHERE id = 120001;
