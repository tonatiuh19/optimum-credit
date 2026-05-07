-- ============================================================================
-- TESTING UTILITY: Delete a client or admin by ID
-- Edit the variables below, then run ONE of the two sections.
-- ============================================================================

-- ── SET YOUR TARGET EMAIL HERE ───────────────────────────────────────────────
SET @client_email = 'client@example.com';   -- ← replace with the client email to delete
SET @admin_email  = 'admin@example.com';    -- ← replace with the admin email to delete

-- ── DELETE CLIENT ────────────────────────────────────────────────────────────
-- All related rows cascade automatically (payments, documents, contracts,
-- sessions, conversations, tickets, reports, notifications, AI sessions, etc.)
-- Uncomment the line below to execute:

-- DELETE FROM `clients` WHERE `email` = 'alex@disruptinglabs.com';


-- ── DELETE ADMIN ─────────────────────────────────────────────────────────────
-- Related rows: admin_otp_codes, admin_sessions → CASCADE
-- Related rows on other tables: reviewed_by_admin_id, assigned_admin_id,
--   changed_by_admin_id, created_by_admin_id, sent_by_admin_id → SET NULL
-- Uncomment the line below to execute:

-- DELETE FROM `admins` WHERE `email` = @admin_email;


-- ── VERIFY AFTER DELETION ────────────────────────────────────────────────────
-- Uncomment to confirm the row is gone:

-- SELECT id, email FROM `clients` WHERE `email` = @client_email;
-- SELECT id, email FROM `admins`  WHERE `email` = @admin_email;
