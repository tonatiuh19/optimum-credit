/**
 * Pure client-reminder / activation SMS helpers (no DB, no Express).
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * copies in api/index.ts.
 */

/** Short EN/ES SMS templates for reminder-flow triggers (portal link). */
export function smsClientReminderBody(opts: {
  triggerEvent: string;
  firstName: string;
  lang: string;
  portalUrl: string;
}): string {
  const isEs = opts.lang === "es";
  const name = String(opts.firstName || (isEs ? "hola" : "there")).trim();
  const url = opts.portalUrl;
  const ev = String(opts.triggerEvent || "");
  if (ev === "docs_ready") {
    return isEs
      ? `Hola ${name}, tus documentos ya están listos en Optimum Credit. Revisa tu portal: ${url}`
      : `Hi ${name}, your docs are ready with Optimum Credit. Check your portal: ${url}`;
  }
  if (ev.startsWith("round_") && ev.endsWith("_complete")) {
    const n = ev.replace(/^round_/, "").replace(/_complete$/, "");
    return isEs
      ? `Hola ${name}, tu reporte de Ronda ${n} de Optimum Credit está listo. Descarga segura: ${url}`
      : `Hi ${name}, your Optimum Credit Round ${n} report is ready. Secure download: ${url}`;
  }
  if (ev === "completed") {
    return isEs
      ? `Hola ${name}, ¡felicidades! Tu archivo de crédito con Optimum Credit está limpio. Portal: ${url}`
      : `Hi ${name}, congrats — your Optimum Credit file is clean. Portal: ${url}`;
  }
  if (ev === "payment_due") {
    return isEs
      ? `Hola ${name}, recordatorio de pago Optimum Credit. Detalles en tu portal: ${url}`
      : `Hi ${name}, Optimum Credit payment reminder. Details in your portal: ${url}`;
  }
  // payment_confirmed welcome / upload reminders (default)
  return isEs
    ? `Hola ${name}, Optimum Credit: sube tus documentos para continuar. Portal: ${url}`
    : `Hi ${name}, Optimum Credit: upload your documents to continue. Portal: ${url}`;
}

/** Activation welcome SMS — must include magic onboarding URL when email has one. */
export function smsClientActivated(opts: {
  firstName: string;
  caseNumber?: string | null;
  lang?: string;
  portalUrl: string;
  appUrlFallback?: string;
}): string {
  const isEs = opts.lang === "es";
  const caseBit = opts.caseNumber ? ` #${opts.caseNumber}` : "";
  const fallback = opts.appUrlFallback || "https://www.ofgllc.com";
  const url = String(opts.portalUrl || `${fallback}/portal`).trim();
  if (isEs) {
    return `Hola ${opts.firstName}, tu caso de Optimum Credit${caseBit} ya está activo. Completa tus tareas de inicio: ${url}`;
  }
  return `Hi ${opts.firstName}, your Optimum Credit case${caseBit} is now active. Complete Get Started: ${url}`;
}

export function isClientReminderSmsSettingOn(
  settingValue: string | null | undefined,
): boolean {
  const v = String(settingValue ?? "1")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
