-- ============================================================================
-- Migration: 20260520_210000_seed_doc_templates_cleanup
-- Seed 4 document upload tasks, update service agreement sort_order,
-- and clean all client data (admins untouched — they are in admin_users table)
-- ============================================================================

-- ── Clean client data (FKs with ON DELETE CASCADE handle related tables) ─────
DELETE FROM clients;

-- ── Update service agreement sort_order to come after the 4 doc tasks ────────
UPDATE `onboarding_task_templates`
SET `sort_order` = 50
WHERE `slug` = 'service_agreement';

-- ── Seed 4 document upload task templates ────────────────────────────────────
INSERT IGNORE INTO `onboarding_task_templates`
  (`slug`, `task_type`, `title_en`, `title_es`, `description_en`, `description_es`,
   `upload_config_json`, `is_required`, `is_system`, `sort_order`, `is_active`)
VALUES
  (
    'id_front',
    'upload',
    'Government ID — Front',
    'Identificación Oficial — Frente',
    'Driver''s license or passport (front side)',
    'Licencia de conducir o pasaporte (lado frontal)',
    '{"accept":"image/*,application/pdf","max_mb":10}',
    1, 1, 10, 1
  ),
  (
    'id_back',
    'upload',
    'Government ID — Back',
    'Identificación Oficial — Reverso',
    'Back of your photo ID',
    'Reverso de tu identificación con foto',
    '{"accept":"image/*,application/pdf","max_mb":10}',
    1, 1, 20, 1
  ),
  (
    'ssn_card',
    'upload',
    'Social Security Card',
    'Tarjeta de Seguro Social',
    'Clear photo of your SSN card, or a W-2 showing the full number',
    'Foto clara de tu tarjeta de seguro social, o un W-2 con el número completo',
    '{"accept":"image/*,application/pdf","max_mb":10}',
    1, 1, 30, 1
  ),
  (
    'proof_of_address',
    'upload',
    'Proof of Address',
    'Comprobante de Domicilio',
    'Utility bill, lease, or bank statement — no older than 3 months',
    'Recibo de servicios, contrato de renta o estado de cuenta — no mayor a 3 meses',
    '{"accept":"image/*,application/pdf","max_mb":10}',
    1, 1, 40, 1
  );
