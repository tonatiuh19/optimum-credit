-- Align packages with Optimum Financial Group products & services
-- https://www.optimum-financial-group.com/products-and-services

ALTER TABLE `packages`
  ADD COLUMN IF NOT EXISTS `compare_price_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Original/list price for display (strikethrough)' AFTER `price_cents`;

ALTER TABLE `packages`
  ADD COLUMN IF NOT EXISTS `billing_interval` ENUM('one_time','monthly') NOT NULL DEFAULT 'one_time'
    AFTER `compare_price_cents`;

-- Standard Repair — $1,497 one payment (was $1,990)
UPDATE `packages` SET
  `name` = 'Standard Repair',
  `subtitle` = 'Standard Credit Files',
  `description` = 'Best for standard credit files with common negative items. Covers the most common negative credit items and standard dispute needs in one flat payment.',
  `price_cents` = 149700,
  `compare_price_cents` = 199000,
  `billing_interval` = 'one_time',
  `duration_months` = 5,
  `features_json` = JSON_ARRAY(
    'Late Payments',
    'Collections',
    'Hard Inquiries',
    'Charge-Offs',
    'Personal Info Errors',
    'Incorrect Balances',
    'Duplicate Accounts'
  ),
  `sort_order` = 1,
  `is_active` = 1
WHERE `slug` = 'standard';

-- Complex Repair — $2,497 one payment (was $2,990)
UPDATE `packages` SET
  `name` = 'Complex Repair',
  `subtitle` = 'Serious Derogatory Items',
  `description` = 'Best for files with serious derogatory items requiring advanced strategy. Includes everything in Standard Repair plus more complex negative items that require a stronger approach.',
  `price_cents` = 249700,
  `compare_price_cents` = 299000,
  `billing_interval` = 'one_time',
  `duration_months` = 5,
  `features_json` = JSON_ARRAY(
    'Everything in Standard Repair',
    'Chapter 7 & 13 Bankruptcies',
    'Student Loans',
    'Tax Liens',
    'Medical Bills',
    'Judgments & Foreclosures',
    'Foreclosures',
    'Repossessions',
    'Bureau Inconsistencies',
    'Charge-Offs (advanced furnisher disputes)',
    'Identity & Fraud Items'
  ),
  `sort_order` = 2,
  `is_active` = 1
WHERE `slug` = 'complex';

-- Tradeline — contact / custom pricing (not self-serve checkout)
UPDATE `packages` SET
  `name` = 'Tradeline',
  `subtitle` = 'High-Impact Credit Boost',
  `description` = 'Individuals with moderate credit issues requiring a more robust approach. We enhance your credit profile by adding authorized trade lines.',
  `price_cents` = 0,
  `compare_price_cents` = NULL,
  `billing_interval` = 'one_time',
  `duration_months` = 5,
  `features_json` = JSON_ARRAY(
    'Consultation — review your profile and recommend trade lines',
    'Account Placement — authorized user on a seasoned account',
    'Reporting — updates on your credit report in 30–60 days'
  ),
  `sort_order` = 3,
  `is_active` = 0
WHERE `slug` = 'tradeline';

-- Expedited Inquiries Removal — $600 one payment (was $800)
INSERT INTO `packages` (
  `slug`, `name`, `subtitle`, `description`,
  `price_cents`, `compare_price_cents`, `billing_interval`,
  `duration_months`, `features_json`, `is_active`, `sort_order`
) VALUES (
  'inquiries_removal',
  'Inquiries Removal',
  'Expedited',
  'Get negative inquiries removed from your credit report. We work to remove hard inquiries that negatively impact your credit score.',
  60000,
  80000,
  'one_time',
  1,
  JSON_ARRAY(
    'Fast & reliable hard inquiry removal',
    'Increase your credit score',
    'Professional dispute process with bureaus and creditors',
    'Submit your request with credit report details',
    'We handle all disputes with the bureaus',
    'See results in 30–60 days on your updated report'
  ),
  1,
  4
)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `subtitle` = VALUES(`subtitle`),
  `description` = VALUES(`description`),
  `price_cents` = VALUES(`price_cents`),
  `compare_price_cents` = VALUES(`compare_price_cents`),
  `billing_interval` = VALUES(`billing_interval`),
  `duration_months` = VALUES(`duration_months`),
  `features_json` = VALUES(`features_json`),
  `is_active` = VALUES(`is_active`),
  `sort_order` = VALUES(`sort_order`);

-- Peace of Mind — $49.99/month (existing clients only; not public registration)
INSERT INTO `packages` (
  `slug`, `name`, `subtitle`, `description`,
  `price_cents`, `compare_price_cents`, `billing_interval`,
  `duration_months`, `features_json`, `is_active`, `sort_order`
) VALUES (
  'peace_of_mind',
  'Peace of Mind Plan',
  'Exclusive for Optimum Clients',
  'Unlimited support and priority service for clients who have completed credit repair. Eligibility: available after completing a credit repair service.',
  4999,
  8000,
  'monthly',
  1,
  JSON_ARRAY(
    'Unlimited credit repair support',
    'Priority service and faster response times',
    'Continuous credit monitoring & disputes',
    'Hassle-free assistance — no extra charges'
  ),
  0,
  5
)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `subtitle` = VALUES(`subtitle`),
  `description` = VALUES(`description`),
  `price_cents` = VALUES(`price_cents`),
  `compare_price_cents` = VALUES(`compare_price_cents`),
  `billing_interval` = VALUES(`billing_interval`),
  `duration_months` = VALUES(`duration_months`),
  `features_json` = VALUES(`features_json`),
  `is_active` = VALUES(`is_active`),
  `sort_order` = VALUES(`sort_order`);
