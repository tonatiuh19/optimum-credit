-- ============================================================================
-- Migration: 20260520_100000_onboarding_tasks
-- Adds admin-managed onboarding task templates and per-client completions
-- Compatible with TiDB Cloud Serverless (MySQL 8.0)
-- ============================================================================

-- ── Table: onboarding_task_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `onboarding_task_templates` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `slug`             VARCHAR(100)  NOT NULL UNIQUE,
  `task_type`        ENUM('form','upload','sign_document') NOT NULL DEFAULT 'form',
  `title_en`         VARCHAR(255)  NOT NULL,
  `title_es`         VARCHAR(255)  NOT NULL,
  `description_en`   TEXT          DEFAULT NULL,
  `description_es`   TEXT          DEFAULT NULL,
  -- For sign_document type: bilingual HTML bodies
  `content_html_en`  MEDIUMTEXT    DEFAULT NULL,
  `content_html_es`  MEDIUMTEXT    DEFAULT NULL,
  -- For form type: JSON array of field definitions
  -- [ { key, label_en, label_es, type: 'text'|'date'|'checkbox'|'select', required, options? } ]
  `form_fields_json` JSON          DEFAULT NULL,
  -- For upload type: accepted MIME types + max size
  -- { accept: 'image/*,application/pdf', max_mb: 10 }
  `upload_config_json` JSON        DEFAULT NULL,
  `is_required`      TINYINT(1)    NOT NULL DEFAULT 1,
  -- is_system = 1 means it cannot be deleted (seeded by the platform)
  `is_system`        TINYINT(1)    NOT NULL DEFAULT 0,
  `sort_order`       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `is_active`        TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ott_active_order` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Table: client_task_completions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `client_task_completions` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `client_id`           INT UNSIGNED  NOT NULL,
  `task_template_id`    INT UNSIGNED  NOT NULL,
  `status`              ENUM('pending','completed','skipped') NOT NULL DEFAULT 'pending',
  -- Form task: submitted field values
  `form_data_json`      JSON          DEFAULT NULL,
  -- Upload task: CDN storage key + original filename
  `file_storage_key`    VARCHAR(500)  DEFAULT NULL,
  `file_name`           VARCHAR(255)  DEFAULT NULL,
  `file_mime`           VARCHAR(100)  DEFAULT NULL,
  -- Sign document task
  `signature_name`      VARCHAR(150)  DEFAULT NULL,
  `signature_ip`        VARCHAR(45)   DEFAULT NULL,
  `completed_at`        DATETIME      DEFAULT NULL,
  `created_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY  `uq_client_task` (`client_id`, `task_template_id`),
  KEY `idx_ctc_client`   (`client_id`),
  KEY `idx_ctc_template` (`task_template_id`),
  CONSTRAINT `fk_ctc_client`
    FOREIGN KEY (`client_id`)        REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ctc_template`
    FOREIGN KEY (`task_template_id`) REFERENCES `onboarding_task_templates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seed: Service Agreement (sign_document, bilingual, system-protected) ─────
INSERT INTO `onboarding_task_templates`
  (`slug`, `task_type`, `title_en`, `title_es`,
   `description_en`, `description_es`,
   `content_html_en`, `content_html_es`,
   `is_required`, `is_system`, `sort_order`, `is_active`)
VALUES (
  'service_agreement',
  'sign_document',
  'Service Agreement',
  'Acuerdo de Servicio',
  'Read and sign our service agreement to authorize us to dispute items on your behalf.',
  'Lea y firme nuestro acuerdo de servicio para autorizarnos a disputar elementos en su nombre.',
  -- EN content
  '<div class="prose max-w-none">
  <h2 class="text-xl font-bold mb-4">OPTIMUM CREDIT REPAIR — SERVICE AGREEMENT</h2>
  <p class="text-sm text-muted-foreground mb-4">Effective upon client signature</p>

  <h3 class="font-semibold mt-6 mb-2">1. PARTIES</h3>
  <p>This Service Agreement ("Agreement") is entered into between <strong>Optimum Credit Repair LLC</strong> ("Company") and the undersigned client ("Client").</p>

  <h3 class="font-semibold mt-6 mb-2">2. SERVICES</h3>
  <p>The Company agrees to provide credit repair services including: analysis of the Client''s credit reports, preparation and submission of dispute letters to credit bureaus, negotiation with creditors, and ongoing progress monitoring.</p>

  <h3 class="font-semibold mt-6 mb-2">3. CLIENT AUTHORIZATION</h3>
  <p>Client authorizes Optimum Credit Repair LLC to act on their behalf in disputing inaccurate, unverifiable, or outdated information on their credit reports with Equifax, Experian, and TransUnion.</p>

  <h3 class="font-semibold mt-6 mb-2">4. CLIENT RESPONSIBILITIES</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>Provide accurate personal information and documents as requested.</li>
    <li>Notify the Company of any changes in address, phone, or email.</li>
    <li>Promptly respond to any requests from the Company or credit bureaus.</li>
    <li>Make timely payments for services rendered.</li>
  </ul>

  <h3 class="font-semibold mt-6 mb-2">5. FEES AND PAYMENT</h3>
  <p>Client agrees to pay the fees associated with their selected service package. Fees are charged as described at the time of enrollment. No refunds are provided once dispute letters have been submitted.</p>

  <h3 class="font-semibold mt-6 mb-2">6. CREDIT REPAIR ORGANIZATIONS ACT (CROA)</h3>
  <p>Pursuant to the Credit Repair Organizations Act (15 U.S.C. § 1679 et seq.), the Company may not: (a) charge or receive money before services are fully performed; (b) make false or misleading representations; (c) advise clients to make false statements to credit reporting agencies.</p>

  <h3 class="font-semibold mt-6 mb-2">7. RIGHT TO CANCEL</h3>
  <p>Client may cancel this Agreement without penalty within <strong>3 business days</strong> of signing by providing written notice to support@optimumcreditrepair.com.</p>

  <h3 class="font-semibold mt-6 mb-2">8. RESULTS DISCLAIMER</h3>
  <p>The Company cannot guarantee specific results. Credit repair outcomes depend on factors outside the Company''s control, including creditor responses and the accuracy of information on file.</p>

  <h3 class="font-semibold mt-6 mb-2">9. GOVERNING LAW</h3>
  <p>This Agreement shall be governed by the laws of the State of Florida, without regard to conflict-of-law principles.</p>

  <h3 class="font-semibold mt-6 mb-2">10. ENTIRE AGREEMENT</h3>
  <p>This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions, representations, or agreements, whether oral or written.</p>
  </div>',
  -- ES content
  '<div class="prose max-w-none">
  <h2 class="text-xl font-bold mb-4">OPTIMUM CREDIT REPAIR — ACUERDO DE SERVICIO</h2>
  <p class="text-sm text-muted-foreground mb-4">Vigente a partir de la firma del cliente</p>

  <h3 class="font-semibold mt-6 mb-2">1. PARTES</h3>
  <p>Este Acuerdo de Servicio ("Acuerdo") se celebra entre <strong>Optimum Credit Repair LLC</strong> ("Empresa") y el cliente que firma a continuación ("Cliente").</p>

  <h3 class="font-semibold mt-6 mb-2">2. SERVICIOS</h3>
  <p>La Empresa acuerda proporcionar servicios de reparación de crédito que incluyen: análisis de los reportes de crédito del Cliente, preparación y envío de cartas de disputa a las agencias de crédito, negociación con acreedores y monitoreo continuo del progreso.</p>

  <h3 class="font-semibold mt-6 mb-2">3. AUTORIZACIÓN DEL CLIENTE</h3>
  <p>El Cliente autoriza a Optimum Credit Repair LLC a actuar en su nombre para disputar información inexacta, no verificable u obsoleta en sus reportes de crédito ante Equifax, Experian y TransUnion.</p>

  <h3 class="font-semibold mt-6 mb-2">4. RESPONSABILIDADES DEL CLIENTE</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>Proporcionar información personal y documentos precisos según se solicite.</li>
    <li>Notificar a la Empresa cualquier cambio en dirección, teléfono o correo electrónico.</li>
    <li>Responder de forma oportuna a cualquier solicitud de la Empresa o de las agencias de crédito.</li>
    <li>Realizar pagos oportunos por los servicios prestados.</li>
  </ul>

  <h3 class="font-semibold mt-6 mb-2">5. HONORARIOS Y PAGO</h3>
  <p>El Cliente acepta pagar los honorarios asociados con su paquete de servicio seleccionado. Los honorarios se cobran según se describe al momento de la inscripción. No se realizan reembolsos una vez que se han enviado las cartas de disputa.</p>

  <h3 class="font-semibold mt-6 mb-2">6. LEY DE ORGANIZACIONES DE REPARACIÓN DE CRÉDITO (CROA)</h3>
  <p>De conformidad con la Ley de Organizaciones de Reparación de Crédito (15 U.S.C. § 1679 et seq.), la Empresa no puede: (a) cobrar dinero antes de que los servicios se realicen completamente; (b) hacer declaraciones falsas o engañosas; (c) asesorar a los clientes para que hagan declaraciones falsas a las agencias de reporte de crédito.</p>

  <h3 class="font-semibold mt-6 mb-2">7. DERECHO DE CANCELACIÓN</h3>
  <p>El Cliente puede cancelar este Acuerdo sin penalización dentro de los <strong>3 días hábiles</strong> siguientes a la firma, enviando aviso por escrito a support@optimumcreditrepair.com.</p>

  <h3 class="font-semibold mt-6 mb-2">8. DESCARGO DE RESULTADOS</h3>
  <p>La Empresa no puede garantizar resultados específicos. Los resultados de la reparación de crédito dependen de factores fuera del control de la Empresa, incluyendo las respuestas de los acreedores y la precisión de la información registrada.</p>

  <h3 class="font-semibold mt-6 mb-2">9. LEY APLICABLE</h3>
  <p>Este Acuerdo se regirá por las leyes del Estado de Florida, sin consideración a los principios de conflicto de leyes.</p>

  <h3 class="font-semibold mt-6 mb-2">10. ACUERDO COMPLETO</h3>
  <p>Este Acuerdo constituye el acuerdo completo entre las partes y reemplaza todas las discusiones, representaciones o acuerdos previos, ya sean orales o escritos.</p>
  </div>',
  1, 1, 10, 1
) ON DUPLICATE KEY UPDATE
  `title_en` = VALUES(`title_en`),
  `title_es` = VALUES(`title_es`);
