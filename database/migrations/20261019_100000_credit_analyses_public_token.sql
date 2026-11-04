-- Credit Analysis: secure handle for the public / portal result screen to
-- read the new-engine status, analysis and PDF (never the numeric id).
ALTER TABLE credit_analyses
  ADD COLUMN public_token CHAR(32) DEFAULT NULL
    COMMENT 'Random hex handle for public/portal new-engine result access';
ALTER TABLE credit_analyses
  ADD UNIQUE KEY uq_credit_analyses_public_token (public_token);
