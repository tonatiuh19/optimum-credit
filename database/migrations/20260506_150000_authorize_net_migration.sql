-- ============================================================================
-- Migration: Stripe → Authorize.net
-- Date: 2026-05-06
-- Description:
--   - Rename stripe-specific column names to provider-agnostic equivalents
--   - Extend the provider ENUM to include 'authorize_net'
--   - Default provider is now 'authorize_net'
-- ============================================================================

-- Step 1: Rename stripe-specific columns to provider-agnostic names
--         (The UNIQUE constraint on stripe_payment_intent_id is preserved with
--          the old name after the CHANGE; we drop & recreate it below.)
ALTER TABLE `payments`
  CHANGE COLUMN `stripe_payment_intent_id` `provider_transaction_id` VARCHAR(255) DEFAULT NULL,
  CHANGE COLUMN `stripe_charge_id`         `provider_charge_id`      VARCHAR(255) DEFAULT NULL;

-- Step 2: Drop the unique index that was created inline on the old column
--         (MySQL names it after the original column by default)
ALTER TABLE `payments` DROP INDEX `stripe_payment_intent_id`;

-- Step 3: Re-add the unique index under the new column name
ALTER TABLE `payments` ADD UNIQUE KEY `idx_provider_transaction_id` (`provider_transaction_id`);

-- Step 4: Extend the provider ENUM to include authorize_net and change default
ALTER TABLE `payments`
  MODIFY COLUMN `provider` ENUM('stripe','authorize_net','manual') NOT NULL DEFAULT 'authorize_net';
