-- Persist flat Optimum credit-analysis algorithm output alongside HTML/text.
ALTER TABLE `credit_analyses`
  ADD COLUMN `analyst_json` JSON DEFAULT NULL AFTER `labels_suggested_json`;
