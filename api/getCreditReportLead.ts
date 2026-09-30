/**
 * Pure helpers for /get-credit-report prospect capture (unit-tested).
 * Event tags use America/Los_Angeles calendar dates only.
 */

export const MFSN_FREE_SNAPSHOT_URL =
  "https://app.myfreescorenow.com/credit-snapshot/29544?s=MXxmYWxzZQ%3D%3D";

/** César Gomez OFG line — SMS From for prospect welcome texts only. */
export const GET_CREDIT_REPORT_SMS_FROM_E164 = "+19496740714";

export const GET_CREDIT_REPORT_SOURCE_LABEL = "get_credit_report";
export const GOLF_TOURNAMENT_LABEL_SLUG = "golf_tournament_prospect";
export const LAS_VEGAS_EVENT_LABEL_SLUG = "las_vegas_event";

export type GetCreditReportEventKind = "golf" | "vegas" | null;

/** Staff alert SMS body (EN) — keep under ~320 chars. */
export function smsGetCreditReportStaffAlert(opts: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  lang?: string;
  eventKind?: GetCreditReportEventKind;
  pipelineUrl: string;
}): string {
  const name =
    `${String(opts.firstName || "").trim()} ${String(opts.lastName || "").trim()}`.trim() ||
    "Lead";
  const lang = opts.lang === "es" ? "ES" : "EN";
  const event =
    opts.eventKind === "golf"
      ? " · golf"
      : opts.eventKind === "vegas"
        ? " · vegas"
        : "";
  const phone = String(opts.phone || "").trim();
  const email = String(opts.email || "").trim();
  const url = String(opts.pipelineUrl || "").trim();
  return `OFG free-report lead: ${name} · ${phone} · ${email} · ${lang}${event}. ${url}`.slice(
    0,
    320,
  );
}

/** YYYY-MM-DD in America/Los_Angeles. */
export function laCalendarDateYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Event label for Golf (2026-09-14) / Las Vegas (2026-09-15) only.
 * Any other day → null (no event tag).
 */
export function getCreditReportEventLabelSlug(
  ymd: string = laCalendarDateYmd(),
): string | null {
  if (ymd === "2026-09-14") return GOLF_TOURNAMENT_LABEL_SLUG;
  if (ymd === "2026-09-15") return LAS_VEGAS_EVENT_LABEL_SLUG;
  return null;
}

export function getCreditReportLabelSlugs(
  ymd: string = laCalendarDateYmd(),
): string[] {
  const slugs = [GET_CREDIT_REPORT_SOURCE_LABEL];
  const event = getCreditReportEventLabelSlug(ymd);
  if (event) slugs.push(event);
  return slugs;
}

export function getCreditReportEventKind(
  ymd: string = laCalendarDateYmd(),
): GetCreditReportEventKind {
  if (ymd === "2026-09-14") return "golf";
  if (ymd === "2026-09-15") return "vegas";
  return null;
}

export function freeScoreShortPath(): string {
  return "/go/free-score";
}
