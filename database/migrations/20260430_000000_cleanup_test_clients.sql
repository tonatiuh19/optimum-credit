-- ============================================================================
-- Cleanup: delete all test / development client records and their cascaded data
--
-- All child tables have ON DELETE CASCADE from clients.id, so a single DELETE
-- on `clients` removes:
--   client_otp_codes, client_sessions, payments, client_documents,
--   onboarding_tokens, client_contracts, client_round_reports,
--   client_pipeline_history, conversations (+ messages), support_tickets
--   (+ replies), ai_chat_sessions (+ messages), notification_queue
--
-- audit_logs has no FK to clients — we clean those by entity reference.
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 1; -- cascade is handled by the FK constraints

-- -------------------------------------------------------------------
-- 1. Identify test clients (adjust the WHERE clause as needed).
--    Current test emails / patterns:
--      - anything @example.com
--      - disruptinglabs.com addresses used during testing
--      - clients still in 'pending_payment' status (never completed checkout)
--      - the known test user "Lionel Messi" seeded via the Fill Test Data button
-- -------------------------------------------------------------------

-- Preview first (safe, read-only):
-- SELECT id, email, first_name, last_name, status, created_at
-- FROM clients
-- WHERE
--   email LIKE '%@example.com'
--   OR email = 'alex@disruptinglabs.com'
--   OR (first_name = 'Lionel' AND last_name = 'Messi')
--   OR status = 'pending_payment';

-- -------------------------------------------------------------------
-- 2. Clean up audit_logs rows that reference these clients
--    (no FK, must be done manually before deleting clients)
-- -------------------------------------------------------------------
DELETE FROM audit_logs
WHERE entity_type = 'client'
  AND entity_id IN (
    SELECT id FROM (
      SELECT id FROM clients
      WHERE
        email LIKE '%@example.com'
        OR email = 'alex@disruptinglabs.com'
        OR (first_name = 'Lionel' AND last_name = 'Messi')
        OR status = 'pending_payment'
    ) AS t
  );

-- -------------------------------------------------------------------
-- 3. Delete the test clients — all child rows cascade automatically
-- -------------------------------------------------------------------
DELETE FROM clients
WHERE
  email LIKE '%@example.com'
  OR email = 'alex@disruptinglabs.com'
  OR (first_name = 'Lionel' AND last_name = 'Messi')
  OR status = 'pending_payment';

-- -------------------------------------------------------------------
-- 4. Verify
-- -------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM clients WHERE email LIKE '%@example.com' OR status = 'pending_payment') AS remaining_test_clients,
  (SELECT COUNT(*) FROM clients) AS total_clients;
