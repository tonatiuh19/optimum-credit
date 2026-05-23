-- ============================================================================
-- Spanish (ES) email templates for all reminder flows
-- Slugs follow the pattern: {original_slug}_es
-- triggerReminderFlow() will prefer these when client.preferred_language = 'es'
-- ============================================================================

INSERT INTO `communication_templates`
  (`slug`, `name`, `channel`, `subject`, `body`, `variables_json`)
VALUES
  -- ── New Client: Day 1 Welcome (ES) ─────────────────────────────────────────
  (
    'flow_new_client_day1_es',
    '[Flow] Nuevo Cliente — Día 1 Bienvenida (ES)',
    'email',
    '¡Bienvenido a Optimum Credit, {{first_name}}! Sube tus documentos para comenzar.',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡Bienvenido, {{first_name}}!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tu pago ha sido confirmado y estamos emocionados de comenzar a trabajar en tu proceso de reparación de crédito. El primer paso es subir tus documentos requeridos para que nuestro equipo pueda comenzar de inmediato.</p>
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">Documentos necesarios:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#334155;line-height:1.8;">
  <li>Identificación oficial con foto (frente y reverso)</li>
  <li>Tarjeta de Seguro Social</li>
  <li>Comprobante de domicilio (recibo de servicio o estado de cuenta, no mayor a 3 meses)</li>
</ul>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Solo toma unos minutos — haz clic en el botón a continuación para subir tus documentos desde tu portal seguro.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),

  -- ── New Client: Day 2 Reminder (ES) ────────────────────────────────────────
  (
    'flow_new_client_day2_es',
    '[Flow] Nuevo Cliente — Día 2 Recordatorio (ES)',
    'email',
    'Recordatorio: Estamos esperando tus documentos, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Estamos esperando tus documentos</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, solo un recordatorio amistoso — aún no hemos recibido tus documentos. Tu proceso de reparación de crédito no puede comenzar hasta que los recibamos.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Subir tus documentos toma solo unos minutos. Estamos aquí y listos para empezar a trabajar por ti en cuanto lleguen.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),

  -- ── New Client: Day 3 Final Reminder (ES) ───────────────────────────────────
  (
    'flow_new_client_day3_es',
    '[Flow] Nuevo Cliente — Día 3 Recordatorio Final (ES)',
    'email',
    'Recordatorio final: Por favor sube tus documentos hoy, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Acción requerida: sube tus documentos hoy</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, este es tu recordatorio final para subir tus documentos. Por favor hazlo hoy para que podamos comenzar a trabajar en tu reparación de crédito de inmediato.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Si tienes algún problema o necesitas ayuda, responde a este correo o abre un ticket de soporte desde tu portal — nuestro equipo está aquí para ayudarte.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  ),

  -- ── Round 1 Progress Report (ES) ────────────────────────────────────────────
  (
    'flow_round_1_complete_es',
    '[Flow] Informe de Progreso Ronda 1 (ES)',
    'email',
    'Tu informe de progreso de la Ronda 1 está listo, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡La Ronda 1 está completa!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, ¡buenas noticias! La Ronda 1 de tu ciclo de reparación de crédito está completa. Hemos trabajado intensamente disputando elementos inexactos en tu reporte de crédito y tu informe de progreso mensual ya está listo.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Inicia sesión en tu portal para ver el informe completo, incluyendo elementos disputados, elementos eliminados y tu puntaje de crédito actualizado.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),

  -- ── Round 2 Progress Report (ES) ────────────────────────────────────────────
  (
    'flow_round_2_complete_es',
    '[Flow] Informe de Progreso Ronda 2 (ES)',
    'email',
    'Tu informe de progreso de la Ronda 2 está listo, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡La Ronda 2 está completa!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, la Ronda 2 de tu reparación de crédito está completa. Seguimos haciendo progreso en tu nombre. Revisa tu último informe en el portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),

  -- ── Round 3 Progress Report (ES) ────────────────────────────────────────────
  (
    'flow_round_3_complete_es',
    '[Flow] Informe de Progreso Ronda 3 (ES)',
    'email',
    'Tu informe de progreso de la Ronda 3 está listo, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡La Ronda 3 está completa — ya superaste la mitad del camino!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, la Ronda 3 de tu reparación de crédito está completa. Ya superaste más de la mitad de tu programa. Consulta tu último informe de progreso en tu portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),

  -- ── Round 4 Progress Report (ES) ────────────────────────────────────────────
  (
    'flow_round_4_complete_es',
    '[Flow] Informe de Progreso Ronda 4 (ES)',
    'email',
    'Tu informe de progreso de la Ronda 4 está listo, {{first_name}}',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡La Ronda 4 está completa — solo queda una más!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, la Ronda 4 de tu reparación de crédito está completa. ¡Ya casi terminas! Consulta tu informe de progreso en tu portal y prepárate para la ronda final.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),

  -- ── Round 5 Final Report (ES) ────────────────────────────────────────────────
  (
    'flow_round_5_complete_es',
    '[Flow] Informe Final Ronda 5 (ES)',
    'email',
    '¡Tu informe final de progreso está listo, {{first_name}}!',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Ronda 5 — ¡tu informe final está listo!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}}, ¡la Ronda 5 de tu reparación de crédito está completa! Este es tu informe mensual final que resume todo lo que hemos logrado juntos. Consulta el resumen completo en tu portal.</p>',
    JSON_ARRAY('first_name', 'portal_url', 'items_removed', 'score_change')
  ),

  -- ── Credit Repair Completed (ES) ─────────────────────────────────────────────
  (
    'flow_completed_es',
    '[Flow] Reparación de Crédito Completada (ES)',
    'email',
    '¡Tu proceso de reparación de crédito está completo, {{first_name}}!',
    '<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">¡Felicitaciones, {{first_name}}!</h2>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tu proceso de reparación de crédito está oficialmente completo. Gracias por confiar en Optimum Credit Repair con tu camino financiero. Estamos muy orgullosos del progreso que hemos logrado juntos.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tu informe final y todos tus documentos están disponibles en tu portal. Te recomendamos continuar monitoreando tu puntaje de crédito y comunicarte con nosotros si necesitas ayuda en el futuro.</p>',
    JSON_ARRAY('first_name', 'portal_url')
  )
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `subject` = VALUES(`subject`), `body` = VALUES(`body`);
