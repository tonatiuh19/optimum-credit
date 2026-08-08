-- Affiliate invite links: optional human-readable public path (slug)
-- URL is /affiliate/join/{slug|token}. NULL slug = use opaque token only.

ALTER TABLE `affiliate_invite_links`
  ADD COLUMN `slug` VARCHAR(64) DEFAULT NULL
    COMMENT 'Optional public path segment; NULL = use token in URL'
    AFTER `token`;

ALTER TABLE `affiliate_invite_links`
  ADD UNIQUE KEY `uq_aff_invite_slug` (`slug`);
