-- Kept for history: Angel preferred_language=es.
-- Superseded for ownership routing by 20260813_191500_admins_language_owner_for.sql
-- (admins.language_owner_for). Safe to re-run.
UPDATE admins
SET preferred_language = 'es'
WHERE email = 'angel@optimum-financial-group.com'
  AND preferred_language <> 'es';
