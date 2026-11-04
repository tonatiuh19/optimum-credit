-- Store every US phone as +1XXXXXXXXXX (E.164). International numbers and
-- non-phone text are left untouched. Same rule as normalizeStoredPhonesInDb()
-- in api/index.ts, which keeps it true for future writes. Idempotent.
UPDATE clients SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE contacts SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE referrers SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE affiliates SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE funding_applications SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE credit_analyses SET agent_phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(agent_phone, '[^0-9]', ''), 10))
WHERE agent_phone IS NOT NULL AND agent_phone NOT REGEXP '^[+]1[0-9]{10}$' AND agent_phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(agent_phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(agent_phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(agent_phone, '[^0-9]', ''), 1) = '1'));
UPDATE admins SET phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10))
WHERE phone IS NOT NULL AND phone NOT REGEXP '^[+]1[0-9]{10}$' AND phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 1) = '1'));
UPDATE admins SET call_forwarding_phone = CONCAT('+1', RIGHT(REGEXP_REPLACE(call_forwarding_phone, '[^0-9]', ''), 10))
WHERE call_forwarding_phone IS NOT NULL AND call_forwarding_phone NOT REGEXP '^[+]1[0-9]{10}$' AND call_forwarding_phone REGEXP '^[-+0-9 ().]+$'
  AND (LENGTH(REGEXP_REPLACE(call_forwarding_phone, '[^0-9]', '')) = 10 OR (LENGTH(REGEXP_REPLACE(call_forwarding_phone, '[^0-9]', '')) = 11 AND LEFT(REGEXP_REPLACE(call_forwarding_phone, '[^0-9]', ''), 1) = '1'));
