-- Tradeline product catalog, client selections, and Peace of Mind subscriptions

ALTER TABLE `packages`
  ADD COLUMN `checkout_type` ENUM('fixed_price','tradeline_picker','subscription') NOT NULL DEFAULT 'fixed_price'
    AFTER `billing_interval`;

UPDATE `packages` SET `checkout_type` = 'fixed_price'
  WHERE `slug` IN ('standard', 'complex', 'inquiries_removal');

UPDATE `packages` SET `checkout_type` = 'tradeline_picker', `is_active` = 1
  WHERE `slug` = 'tradeline';

UPDATE `packages` SET `checkout_type` = 'subscription', `is_active` = 1
  WHERE `slug` = 'peace_of_mind';

CREATE TABLE IF NOT EXISTS `tradeline_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL UNIQUE,
  `name` VARCHAR(120) NOT NULL,
  `details` TEXT NOT NULL,
  `price_cents` INT UNSIGNED NOT NULL,
  `compare_price_cents` INT UNSIGNED DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tradeline_products_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tradeline_products` (`slug`, `name`, `details`, `price_cents`, `compare_price_cents`, `sort_order`) VALUES
  ('capital_one', 'CapitalOne', '$3000 credit limit, 4 years', 105000, 150000, 1),
  ('barclays_aviator', 'Barclays Aviator', 'Limit $21200, Age: 3 Yrs, Statement Date: 16TH, Post Date: 19TH', 125000, 160000, 2),
  ('pnc_bank', 'PNC Bank', 'Limit $17500, Age: 3 Yrs, Statement Date: 1ST, Post Date: 10TH', 125000, 160000, 3),
  ('us_bank_2020_20k', '2020 US Bank 20K', 'Limit $20000, Age: 5 Yrs, Statement/Closing Date: 3rd', 192500, 240000, 4),
  ('chase_2022_18k', '2022 Chase 18K', 'Limit $18000, Almost 3 years, Statement/Closing Date: 18th', 175000, 220000, 5),
  ('capital_one_2022_13_5k', '2022 CapitalOne 13.5K', '$13,500 credit limit, 3 years History, Closing 2nd', 165000, 220000, 6),
  ('us_bank_2015_20k', '2015 US BANK 20k', 'Limit $20000, Age: 10.5 Yrs, Statement/Closing Date: 1ST', 207500, 250000, 7),
  ('us_bank_2019_16_2k', '2019 US Bank 16.2K', 'Limit $16200, Age: 6.5 Yrs, Statement/Closing Date: 2nd', 189500, 220000, 8)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `details` = VALUES(`details`),
  `price_cents` = VALUES(`price_cents`),
  `compare_price_cents` = VALUES(`compare_price_cents`),
  `sort_order` = VALUES(`sort_order`);

CREATE TABLE IF NOT EXISTS `client_tradeline_selections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `payment_id` INT UNSIGNED NOT NULL,
  `tradeline_product_id` INT UNSIGNED NOT NULL,
  `product_name` VARCHAR(120) NOT NULL,
  `product_details` TEXT NOT NULL,
  `price_cents` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tradeline_sel_client` (`client_id`),
  KEY `idx_tradeline_sel_payment` (`payment_id`),
  CONSTRAINT `fk_tradeline_sel_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tradeline_sel_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tradeline_sel_product` FOREIGN KEY (`tradeline_product_id`) REFERENCES `tradeline_products`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_subscriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `package_id` INT UNSIGNED NOT NULL,
  `anet_subscription_id` VARCHAR(64) NOT NULL,
  `status` ENUM('active','cancelled','suspended','expired') NOT NULL DEFAULT 'active',
  `amount_cents` INT UNSIGNED NOT NULL,
  `billing_interval` ENUM('monthly') NOT NULL DEFAULT 'monthly',
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `next_billing_at` DATE DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_sub_anet` (`anet_subscription_id`),
  KEY `idx_client_sub_client` (`client_id`),
  KEY `idx_client_sub_status` (`status`),
  CONSTRAINT `fk_client_sub_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_sub_package` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
