/**
 * Pure helpers for /get-credit-report prospect capture (unit-tested).
 * Event tags + venue banner use America/Los_Angeles calendar dates only.
 */

export const MFSN_FREE_SNAPSHOT_URL =
  "https://app.myfreescorenow.com/credit-snapshot/29544?s=MXxmYWxzZQ%3D%3D";

/** César Gomez OFG line — SMS From for prospect welcome texts only. */
export const GET_CREDIT_REPORT_SMS_FROM_E164 = "+19496740714";

export const GET_CREDIT_REPORT_SOURCE_LABEL = "get_credit_report";
export const GOLF_TOURNAMENT_LABEL_SLUG = "golf_tournament_prospect";
export const LAS_VEGAS_EVENT_LABEL_SLUG = "las_vegas_event";
export const OFY_EVENT_LABEL_SLUG = "ofy";

export type GetCreditReportEventKind = "golf" | "vegas" | "ofy" | null;

export type GetCreditReportEventMeta = {
  kind: Exclude<GetCreditReportEventKind, null>;
  labelSlug: string;
  /** Short place line for UI / staff alerts */
  placeEn: string;
  placeEs: string;
  /** Optional detail under the place (address / time) */
  detailEn: string;
  detailEs: string;
};

/**
 * Dated event calendar (LA). Keep in sync with inline copy in api/index.ts
 * and client/lib/getCreditReportEvent.ts.
 */
export const GET_CREDIT_REPORT_EVENTS: Record<string, GetCreditReportEventMeta> =
  {
    "2026-09-14": {
      kind: "golf",
      labelSlug: GOLF_TOURNAMENT_LABEL_SLUG,
      placeEn: "Golf tournament",
      placeEs: "Torneo de golf",
      detailEn: "",
      detailEs: "",
    },
    "2026-09-15": {
      kind: "vegas",
      labelSlug: LAS_VEGAS_EVENT_LABEL_SLUG,
      placeEn: "Las Vegas",
      placeEs: "Las Vegas",
      detailEn: "",
      detailEs: "",
    },
    "2026-10-01": {
      kind: "ofy",
      labelSlug: OFY_EVENT_LABEL_SLUG,
      placeEn: "Family Fun Night · Chino",
      placeEs: "Family Fun Night · Chino",
      detailEn: "7011 Schaefer Ave Ste E · 5–7 PM",
      detailEs: "7011 Schaefer Ave Ste E · 5–7 PM",
    },
    "2026-10-08": {
      kind: "ofy",
      labelSlug: OFY_EVENT_LABEL_SLUG,
      placeEn: "Family Fun Night · Fontana",
      placeEs: "Family Fun Night · Fontana",
      detailEn: "5–7 PM",
      detailEs: "5–7 PM",
    },
    "2026-10-22": {
      kind: "ofy",
      labelSlug: OFY_EVENT_LABEL_SLUG,
      placeEn: "Family Fun Night · Fontana + Rancho Cucamonga",
      placeEs: "Family Fun Night · Fontana + Rancho Cucamonga",
      detailEn: "5–7 PM",
      detailEs: "5–7 PM",
    },
    "2026-10-29": {
      kind: "ofy",
      labelSlug: OFY_EVENT_LABEL_SLUG,
      placeEn: "Family Fun Night · Upland",
      placeEs: "Family Fun Night · Upland",
      detailEn: "5–7 PM",
      detailEs: "5–7 PM",
    },
  };

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
        : opts.eventKind === "ofy"
          ? " · ofy"
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

export function getCreditReportEventMeta(
  ymd: string = laCalendarDateYmd(),
): GetCreditReportEventMeta | null {
  return GET_CREDIT_REPORT_EVENTS[ymd] ?? null;
}

export function getCreditReportEventLabelSlug(
  ymd: string = laCalendarDateYmd(),
): string | null {
  return getCreditReportEventMeta(ymd)?.labelSlug ?? null;
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
  return getCreditReportEventMeta(ymd)?.kind ?? null;
}

export function freeScoreShortPath(): string {
  return "/go/free-score";
}
