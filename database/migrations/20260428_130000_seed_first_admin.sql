-- Seed the first super admin for Optimum Credit Repair
-- Idempotent: uses INSERT IGNORE on the unique email index.

INSERT IGNORE INTO admins (email, first_name, last_name, role, status)
VALUES ('axgoomez@gmail.com', 'Felix', 'Gomez', 'super_admin', 'active');
