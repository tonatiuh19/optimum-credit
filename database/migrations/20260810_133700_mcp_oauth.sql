-- MCP OAuth (per-admin Cursor / Claude Desktop consent)
-- TiDB Cloud Serverless (MySQL 8.0 compatible)

CREATE TABLE IF NOT EXISTS `mcp_oauth_clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(128) NOT NULL,
  `client_secret_hash` VARCHAR(255) DEFAULT NULL COMMENT 'NULL = public client (PKCE)',
  `client_name` VARCHAR(255) DEFAULT NULL,
  `redirect_uris_json` JSON NOT NULL,
  `grant_types_json` JSON DEFAULT NULL,
  `token_endpoint_auth_method` VARCHAR(64) NOT NULL DEFAULT 'none',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mcp_oauth_clients_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(64) NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `code_challenge` VARCHAR(128) NOT NULL,
  `code_challenge_method` VARCHAR(16) NOT NULL DEFAULT 'S256',
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'admin_ai.read',
  `resource` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mcp_oauth_codes_hash` (`code_hash`),
  KEY `idx_mcp_oauth_codes_admin` (`admin_id`),
  KEY `idx_mcp_oauth_codes_expires` (`expires_at`),
  CONSTRAINT `fk_mcp_oauth_codes_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `access_token_hash` VARCHAR(64) NOT NULL,
  `refresh_token_hash` VARCHAR(64) DEFAULT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `client_name` VARCHAR(255) DEFAULT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'admin_ai.read',
  `resource` VARCHAR(500) DEFAULT NULL,
  `access_expires_at` DATETIME NOT NULL,
  `refresh_expires_at` DATETIME DEFAULT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mcp_oauth_tokens_access` (`access_token_hash`),
  UNIQUE KEY `uk_mcp_oauth_tokens_refresh` (`refresh_token_hash`),
  KEY `idx_mcp_oauth_tokens_admin` (`admin_id`),
  KEY `idx_mcp_oauth_tokens_revoked` (`revoked_at`),
  CONSTRAINT `fk_mcp_oauth_tokens_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
