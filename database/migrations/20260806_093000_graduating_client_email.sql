-- Graduating client email (pipeline stage → completed)
-- Replaces generic flow_completed / flow_completed_es copy with Cesar’s
-- “credit file is clean” celebration message (EN + ES), styled to match
-- existing Optimum email fragment patterns (wrapped by emailLayout at send).

UPDATE `communication_templates`
SET
  `name` = '[Flow] Graduating Client — Credit File Clean',
  `subject` = 'Congratulations — Your Credit File Is Clean!',
  `body` = '<div style="margin:0 0 20px;padding:20px 22px;background:linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 55%,#fffbeb 100%);border:1px solid #bbf7d0;border-radius:14px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#15803d;margin-bottom:8px;">Graduated · Case complete</div>
  <h2 style="margin:0;font-size:24px;font-weight:800;color:#0f172a;line-height:1.25;">Congratulations — your credit file is clean!</h2>
</div>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi {{first_name}},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">We have great news — your credit file is now completely clean! Every negative item we set out to dispute has been resolved, and your report is in great shape.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">That means your work with <strong>Optimum Financial Group</strong> is complete. You no longer need our services, and we wanted to be the first to celebrate this with you — this is the result of your patience and follow-through, and we''re proud of where your file stands today.</p>
<div style="margin:20px 0;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">A couple of things as we close things out:</div>
  <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.65;color:#334155;">
    <li style="margin:0 0 10px;">You''re free to cancel the credit monitoring service you signed up for if you no longer want it. There''s no obligation to keep it running now that the work is done — that''s completely your call.</li>
    <li style="margin:0;">If anything ever comes up on your report again, or you want a check-up down the road, we''re here.</li>
  </ul>
</div>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Thank you for trusting us with this. It''s been a pleasure working with you, and we wish you the best going forward.</p>
<p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#475569;">
  Warmly,<br/>
  <strong style="color:#0f172a;">Optimum Financial Group</strong><br/>
  <a href="tel:+19497365644" style="color:#0f172a;text-decoration:none;">(949) 736-5644</a><br/>
  <a href="https://optimum-financial-group.com" style="color:#C0A06A;text-decoration:underline;">optimum-financial-group.com</a>
</p>',
  `variables_json` = JSON_ARRAY('first_name', 'portal_url')
WHERE `slug` = 'flow_completed';

UPDATE `communication_templates`
SET
  `name` = '[Flow] Cliente graduado — Archivo limpio (ES)',
  `subject` = '¡Felicidades — Su archivo de crédito está limpio!',
  `body` = '<div style="margin:0 0 20px;padding:20px 22px;background:linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 55%,#fffbeb 100%);border:1px solid #bbf7d0;border-radius:14px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#15803d;margin-bottom:8px;">Graduado · Caso completado</div>
  <h2 style="margin:0;font-size:24px;font-weight:800;color:#0f172a;line-height:1.25;">¡Felicidades — su archivo de crédito está limpio!</h2>
</div>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola {{first_name}},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tenemos excelentes noticias — ¡su archivo de crédito ahora está completamente limpio! Cada elemento negativo que nos propusimos disputar ha sido resuelto, y su reporte está en muy buenas condiciones.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Esto significa que su trabajo con <strong>Optimum Financial Group</strong> ha sido completado. Ya no necesita nuestros servicios, y quisimos ser los primeros en celebrar esto con usted — este resultado es gracias a su paciencia y constancia, y estamos orgullosos de dónde se encuentra su archivo hoy.</p>
<div style="margin:20px 0;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">Un par de cosas mientras cerramos su caso:</div>
  <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.65;color:#334155;">
    <li style="margin:0 0 10px;">Es libre de cancelar el servicio de monitoreo de crédito al que se suscribió, si ya no lo desea. No hay ninguna obligación de mantenerlo activo ahora que el trabajo está terminado — esa decisión es completamente suya.</li>
    <li style="margin:0;">Si en el futuro surge algo nuevo en su reporte, o desea una revisión, aquí estamos para ayudarle.</li>
  </ul>
</div>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Gracias por confiar en nosotros con esto. Ha sido un placer trabajar con usted, y le deseamos mucho éxito en adelante.</p>
<p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#475569;">
  Con cariño,<br/>
  <strong style="color:#0f172a;">Optimum Financial Group</strong><br/>
  <a href="tel:+19497365644" style="color:#0f172a;text-decoration:none;">(949) 736-5644</a><br/>
  <a href="https://optimum-financial-group.com" style="color:#C0A06A;text-decoration:underline;">optimum-financial-group.com</a>
</p>',
  `variables_json` = JSON_ARRAY('first_name', 'portal_url')
WHERE `slug` = 'flow_completed_es';

-- Clarify ops naming in Reminder Flows admin UI
UPDATE `reminder_flows`
SET
  `name` = 'Graduating Client (Completed)',
  `description` = 'Celebration email when a case moves to Completed — credit file is clean / program finalized (EN + ES by client language).'
WHERE `trigger_event` = 'completed';

UPDATE `reminder_flow_steps` s
JOIN `reminder_flows` f ON f.id = s.flow_id
SET s.`label` = 'Graduating client — credit file clean'
WHERE f.`trigger_event` = 'completed'
  AND s.`template_slug` = 'flow_completed';
