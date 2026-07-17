-- OFG package feature list updates (Standard + Complex Repair)

UPDATE `packages` SET
  `features_json` = JSON_ARRAY(
    'Late Payments',
    'Collections',
    'Hard Inquiries',
    'Charge-Offs',
    'Personal Info Errors',
    'Incorrect Balances',
    'Duplicate Accounts'
  ),
  `updated_at` = NOW()
WHERE `slug` = 'standard';

UPDATE `packages` SET
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
  `updated_at` = NOW()
WHERE `slug` = 'complex';
