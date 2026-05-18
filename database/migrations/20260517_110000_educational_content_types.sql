-- Add content_type and file_url columns to educational_videos
-- This extends the table to support PDFs, images, articles and CDN-uploaded files
-- alongside existing external video URLs.

ALTER TABLE `educational_videos`
  ADD COLUMN `content_type` ENUM('video','pdf','image','article') NOT NULL DEFAULT 'video'
    AFTER `title`,
  ADD COLUMN `file_url` VARCHAR(500) DEFAULT NULL
    COMMENT 'CDN URL for uploaded file (pdf, image, video)'
    AFTER `video_url`;
