-- ============================================================================
-- Migration: 20260506_200000_coupons
-- Adds coupons table for promotional discount codes usable at registration
-- Compatible with: TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `coupons` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`                   VARCHAR(50)  NOT NULL UNIQUE COMMENT 'Uppercase promo code, e.g. SAVE20',
  `description`            VARCHAR(255) DEFAULT NULL,
  `discount_type`          ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage'
                           COMMENT 'percentage = % off price_cents; fixed = flat cents off',
  `discount_value`         INT UNSIGNED NOT NULL COMMENT 'Percent (0-100) or cents amount',
  `min_amount_cents`       INT UNSIGNED NOT NULL DEFAULT 0
                           COMMENT 'Minimum package price for coupon to apply',
  `max_uses`               INT UNSIGNED DEFAULT NULL COMMENT 'NULL = unlimited',
  `uses_count`             INT UNSIGNED NOT NULL DEFAULT 0,
  `applicable_packages`    JSON DEFAULT NULL
                           COMMENT 'Array of package IDs; NULL means all packages',
  `valid_from`             DATETIME DEFAULT NULL,
  `expires_at`             DATETIME DEFAULT NULL,
  `is_active`              TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id`    INT UNSIGNED DEFAULT NULL,
  `created_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_coupons_code`      (`code`),
  KEY `idx_coupons_active`    (`is_active`),
  KEY `idx_coupons_expires`   (`expires_at`),
  CONSTRAINT `fk_coupons_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Track which coupon was used per payment (columns first, then constraint)
ALTER TABLE `payments`
  ADD COLUMN `coupon_id`             INT UNSIGNED DEFAULT NULL
    COMMENT 'Applied coupon, if any',
  ADD COLUMN `discount_cents`        INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Discount amount applied in cents',
  ADD COLUMN `original_amount_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Pre-discount amount (NULL if no coupon was used)';

ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_coupon`
    FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE SET NULL;
