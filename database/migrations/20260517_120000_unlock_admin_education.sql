-- Unlock the Education section for admin (section_key = 'videos')
-- portal_videos was already unlocked in a previous migration.
UPDATE section_locks SET is_locked = 0 WHERE section_key = 'videos';
