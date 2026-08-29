-- Allow funding-only leads with phone but no email (ATLAS create_funding_application).
-- clients.email is already nullable; funding_applications.email was NOT NULL.
ALTER TABLE `funding_applications`
  MODIFY COLUMN `email` VARCHAR(255) DEFAULT NULL;
