-- Client Info Requests: staff-initiated mid-pipeline data collection
-- TiDB Cloud Serverless / MySQL 8.0 compatible

CREATE TABLE IF NOT EXISTS `client_info_requests` (
  `id`                      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `case_id`                 INT UNSIGNED  NOT NULL,
  `client_id`               INT UNSIGNED  NOT NULL,
  `created_by_admin_id`     INT UNSIGNED  DEFAULT NULL,
  `preset_key`              VARCHAR(64)   DEFAULT NULL
    COMMENT 'smart_credit | payment_card | payment_billing | custom | null',
  `title_en`                VARCHAR(255)  NOT NULL,
  `title_es`                VARCHAR(255)  NOT NULL,
  `message_en`              TEXT          DEFAULT NULL,
  `message_es`              TEXT          DEFAULT NULL,
  `fields_json`             JSON          NOT NULL
    COMMENT 'array of InfoRequestFieldDef',
  `status`                  ENUM(
                              'open',
                              'submitted',
                              'approved',
                              'rejected',
                              'cancelled'
                            ) NOT NULL DEFAULT 'open',
  `due_at`                  DATETIME      DEFAULT NULL,
  `response_json`           JSON          DEFAULT NULL
    COMMENT 'non-sensitive answers',
  `secrets_ciphertext`      MEDIUMBLOB    DEFAULT NULL
    COMMENT 'AES-256-GCM encrypted JSON of sensitive answers',
  `secrets_iv`              VARCHAR(64)   DEFAULT NULL,
  `secrets_tag`             VARCHAR(64)   DEFAULT NULL,
  `client_consented_at`     DATETIME      DEFAULT NULL,
  `client_consent_ip`       VARCHAR(45)   DEFAULT NULL,
  `terms_doc_updated_at`    DATETIME      DEFAULT NULL,
  `privacy_doc_updated_at`  DATETIME      DEFAULT NULL,
  `submitted_at`            DATETIME      DEFAULT NULL,
  `reviewed_at`             DATETIME      DEFAULT NULL,
  `reviewed_by_admin_id`    INT UNSIGNED  DEFAULT NULL,
  `rejection_reason`        TEXT          DEFAULT NULL,
  `created_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cir_case`     (`case_id`),
  KEY `idx_cir_client`   (`client_id`),
  KEY `idx_cir_status`   (`status`),
  KEY `idx_cir_client_status` (`client_id`, `status`),
  CONSTRAINT `fk_cir_case`
    FOREIGN KEY (`case_id`) REFERENCES `credit_repair_cases`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cir_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_info_request_files` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `request_id`       INT UNSIGNED  NOT NULL,
  `field_key`        VARCHAR(100)  NOT NULL,
  `file_name`        VARCHAR(255)  NOT NULL,
  `mime_type`        VARCHAR(100)  DEFAULT NULL,
  `file_size`        INT UNSIGNED  DEFAULT NULL,
  `storage_provider` ENUM('local','cdn') NOT NULL DEFAULT 'cdn',
  `storage_key`      VARCHAR(500)  NOT NULL,
  `encrypted`        TINYINT(1)    NOT NULL DEFAULT 1,
  `enc_iv`           VARCHAR(64)   DEFAULT NULL,
  `enc_tag`          VARCHAR(64)   DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cirf_request` (`request_id`),
  CONSTRAINT `fk_cirf_request`
    FOREIGN KEY (`request_id`) REFERENCES `client_info_requests`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
