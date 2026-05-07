-- Add Authorize.net customer profile IDs to clients table.
-- When a charge is processed, Authorize.net returns a customerProfileId and
-- customerPaymentProfileId (when createCustomerProfile:true is set on the transaction).
-- Storing these lets us link future charges to the same customer profile,
-- and causes the customer to appear in Authorize.net → Manage Customers.

ALTER TABLE clients
  ADD COLUMN `anet_customer_profile_id` VARCHAR(64) DEFAULT NULL AFTER `stripe_customer_id`;

ALTER TABLE clients
  ADD COLUMN `anet_payment_profile_id`  VARCHAR(64) DEFAULT NULL AFTER `anet_customer_profile_id`;
