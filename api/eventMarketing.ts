/**
 * Pure helpers for Event Marketing CRM section (unit-tested).
 * Welcome merge tokens + next-session picker + public URL builders.
 */

export const EVENT_MARKETING_SOURCE_LABEL = "event_marketing";
export const EVENT_MARKETING_NOTIFY_KEY = "event_registration" as const;

export type EventMarketingMergeVars = {
  first_name: string;
  session_title: string;
  session_when: string;
  session_location: string;
  class_note: string;
  comic_note: string;
  report_url: string;
  class_link: string;
};

/** Replace {{token}} placeholders (case-insensitive keys). */
export function applyEventMarketingTemplate(
  template: string,
  vars: Partial<EventMarketingMergeVars>,
): string {
  const map: Record<string, string> = {
    first_name: String(vars.first_name || "").trim() || "there",
    session_title: String(vars.session_title || "").trim(),
    session_when: String(vars.session_when || "").trim(),
    session_location: String(vars.session_location || "").trim(),
    class_note: String(vars.class_note || "").trim(),
    comic_note: String(vars.comic_note || "").trim(),
    report_url: String(vars.report_url || "").trim(),
    class_link: String(vars.class_link || "").trim(),
  };
  return String(template || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : "";
  });
}

export function eventCompanyPublicPath(slug: string): string {
  return `/e/${encodeURIComponent(String(slug || "").trim())}`;
}

export function eventSessionPublicPath(companySlug: string, shortCode: string): string {
  return `/e/${encodeURIComponent(String(companySlug || "").trim())}/s/${encodeURIComponent(String(shortCode || "").trim())}`;
}

export type EventSessionPickRow = {
  id: number;
  starts_at: string | Date;
  status: string;
};

/**
 * Auto-pick: soonest scheduled session with starts_at >= now (LA wall clock
 * compared as DATETIME strings). Falls back to soonest future-or-past scheduled.
 */
export function pickNextEventSessionId(
  sessions: EventSessionPickRow[],
  now: Date = new Date(),
): number | null {
  const scheduled = sessions.filter((s) => s.status === "scheduled");
  if (!scheduled.length) return null;
  const nowMs = now.getTime();
  const upcoming = scheduled
    .map((s) => ({
      id: s.id,
      ms: new Date(s.starts_at).getTime(),
    }))
    .filter((s) => !Number.isNaN(s.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!upcoming.length) return null;
  const next = upcoming.find((s) => s.ms >= nowMs - 2 * 60 * 60 * 1000);
  return (next || upcoming[upcoming.length - 1]).id;
}

export function slugifyEventCode(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function buildClassNote(opts: {
  lang: "en" | "es";
  classLink?: string | null;
  scheduleNote?: string | null;
}): string {
  const link = String(opts.classLink || "").trim();
  const note = String(opts.scheduleNote || "").trim();
  const parts: string[] = [];
  if (link) {
    parts.push(
      opts.lang === "es" ? ` Enlace Zoom: ${link}.` : ` Zoom link: ${link}.`,
    );
  }
  if (note) {
    parts.push(opts.lang === "es" ? ` ${note}` : ` ${note}`);
  }
  return parts.join("");
}

export function buildComicNote(opts: {
  lang: "en" | "es";
  offerComic: boolean;
}): string {
  if (!opts.offerComic) return "";
  return opts.lang === "es"
    ? " y un cómic de educación financiera"
    : " and a financial literacy comic book";
}
