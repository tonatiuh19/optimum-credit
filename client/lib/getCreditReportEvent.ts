/**
 * Client mirror of api/getCreditReportLead event calendar (UI venue banner).
 * Keep dates/places in sync with api/getCreditReportLead.ts + api/index.ts.
 */

export type GetCreditReportEventKind = "golf" | "vegas" | "ofy" | null;

export type GetCreditReportEventMeta = {
  kind: Exclude<GetCreditReportEventKind, null>;
  placeEn: string;
  placeEs: string;
  detailEn: string;
  detailEs: string;
};

const EVENTS: Record<string, GetCreditReportEventMeta> = {
  "2026-09-14": {
    kind: "golf",
    placeEn: "Golf tournament",
    placeEs: "Torneo de golf",
    detailEn: "",
    detailEs: "",
  },
  "2026-09-15": {
    kind: "vegas",
    placeEn: "Las Vegas",
    placeEs: "Las Vegas",
    detailEn: "",
    detailEs: "",
  },
  "2026-10-01": {
    kind: "ofy",
    placeEn: "Family Fun Night · Chino",
    placeEs: "Family Fun Night · Chino",
    detailEn: "7011 Schaefer Ave Ste E · 5–7 PM",
    detailEs: "7011 Schaefer Ave Ste E · 5–7 PM",
  },
  "2026-10-08": {
    kind: "ofy",
    placeEn: "Family Fun Night · Fontana",
    placeEs: "Family Fun Night · Fontana",
    detailEn: "5–7 PM",
    detailEs: "5–7 PM",
  },
  "2026-10-22": {
    kind: "ofy",
    placeEn: "Family Fun Night · Fontana + Rancho Cucamonga",
    placeEs: "Family Fun Night · Fontana + Rancho Cucamonga",
    detailEn: "5–7 PM",
    detailEs: "5–7 PM",
  },
  "2026-10-29": {
    kind: "ofy",
    placeEn: "Family Fun Night · Upland",
    placeEs: "Family Fun Night · Upland",
    detailEn: "5–7 PM",
    detailEs: "5–7 PM",
  },
};

export function laCalendarDateYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getCreditReportEventMeta(
  now: Date = new Date(),
): GetCreditReportEventMeta | null {
  return EVENTS[laCalendarDateYmd(now)] ?? null;
}
