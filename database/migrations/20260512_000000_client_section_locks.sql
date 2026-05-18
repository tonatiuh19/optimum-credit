-- Seed client portal section locks (prefix: portal_)
-- These mirror the client nav items and can be toggled from the admin Settings page.

INSERT INTO `section_locks` (`section_key`, `label`, `is_locked`, `lock_reason`) VALUES
  ('portal_dashboard',       'Portal — Dashboard',         1, 'Coming soon — client dashboard is under construction.'),
  ('portal_contract',        'Portal — Service Agreement', 1, 'Coming soon — contracts module is under construction.'),
  ('portal_reports',         'Portal — Progress Reports',  1, 'Coming soon — reports are under construction.'),
  ('portal_optibot',         'Portal — Optibot AI',        1, 'Coming soon — AI assistant is under construction.'),
  ('portal_videos',          'Portal — Education',         1, 'Coming soon — education centre is under construction.'),
  ('portal_support',         'Portal — Support',           1, 'Coming soon — support tickets are under construction.'),
  ('portal_profile',         'Portal — My Profile',        1, 'Coming soon — profile page is under construction.')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
