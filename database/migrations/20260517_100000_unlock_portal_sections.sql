-- Unlock portal sections: Dashboard, Progress Reports, Education, Support, My Profile
-- Keeps locked: portal_contract (Service Agreement), portal_optibot (Optibot AI)

UPDATE section_locks SET is_locked = 0, lock_reason = NULL
WHERE section_key IN (
  'portal_dashboard',
  'portal_reports',
  'portal_videos',
  'portal_support',
  'portal_profile'
);
