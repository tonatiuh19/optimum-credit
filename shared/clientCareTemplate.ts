/**
 * Client care settings + message templates (Nov 17, 2026). Shared by the server (inlined into
 * api/index.ts by scripts/inline-credit-file-engine.mjs) and the settings screen's live preview, so
 * what staff preview is exactly what clients get. No imports — pure functions only.
 *
 * Template syntax: {token} placeholders; [[ ... ]] is an optional part, dropped when any token inside
 * it is empty ("Hi[[ {first_name}]]!" → "Hi!" when there is no first name).
 */

export type ClientCareLang = "en" | "es";
export type ClientCareKind = "message" | "missed_call";

export interface ClientCareWhenLabels {
  today: string;
  this_morning: string;
  tomorrow_morning: string;
  /** "{weekday} morning" — the next business day by name. */
  day_morning: string;
}

export interface ClientCareSettings {
  auto_reply_enabled: boolean;
  slack_enabled: boolean;
  /** 0 = Sunday … 6 = Saturday, Pacific. */
  business_days: number[];
  business_start: string;
  business_end: string;
  /** After this time on a business day, the answer is promised for the next business morning. */
  reply_today_until: string;
  remind_after_min: number;
  escalate_after_min: number;
  auto_reply_gap_hours: number;
  /** No auto-reply when staff wrote in this conversation within this many minutes. */
  staff_quiet_min: number;
  /** Close items still open after this many business days (0 = never). */
  auto_close_after_days: number;
  escalate_admin_ids: number[];
  templates: Record<ClientCareLang, Record<ClientCareKind, string>>;
  when_labels: Record<ClientCareLang, ClientCareWhenLabels>;
}

export const CLIENT_CARE_TOKENS = ["first_name", "topic", "owner", "owner_phone", "when", "away_name", "return_day", "away_note"] as const;
export type ClientCareToken = (typeof CLIENT_CARE_TOKENS)[number];
export const CLIENT_CARE_REQUIRED_TOKENS: ClientCareToken[] = ["owner", "when"];
export const CLIENT_CARE_TEMPLATE_MAX = 320;

export const CLIENT_CARE_DEFAULT_SETTINGS: ClientCareSettings = {
  auto_reply_enabled: true,
  slack_enabled: true,
  business_days: [1, 2, 3, 4, 5],
  business_start: "08:00",
  business_end: "18:00",
  reply_today_until: "17:00",
  remind_after_min: 120,
  escalate_after_min: 240,
  auto_reply_gap_hours: 12,
  staff_quiet_min: 60,
  auto_close_after_days: 3,
  escalate_admin_ids: [90001],
  templates: {
    en: {
      message:
        "Hi[[ {first_name}]]! We got your message[[ about {topic}]].[[ {away_name} is out of the office until {return_day};]] {owner}[[ (English, {owner_phone})]] will reply {when}. - Optimum Financial Group",
      missed_call:
        "Hi[[ {first_name}]]! We missed your call.[[ {away_name} is out of the office until {return_day};]] {owner}[[ (English, {owner_phone})]] will call you back {when}. - Optimum Financial Group",
    },
    es: {
      message:
        "¡Hola[[ {first_name}]]! Recibimos tu mensaje[[ sobre {topic}]].[[ {away_name} está fuera de la oficina hasta el {return_day};]] {owner}[[ (español, {owner_phone})]] te responderá {when}. - Optimum Financial Group",
      missed_call:
        "¡Hola[[ {first_name}]]! Vimos tu llamada.[[ {away_name} está fuera de la oficina hasta el {return_day};]] {owner}[[ (español, {owner_phone})]] te devolverá la llamada {when}. - Optimum Financial Group",
    },
  },
  when_labels: {
    en: { today: "today", this_morning: "this morning", tomorrow_morning: "tomorrow morning", day_morning: "{weekday} morning" },
    es: { today: "hoy", this_morning: "hoy en la mañana", tomorrow_morning: "mañana en la mañana", day_morning: "el {weekday} en la mañana" },
  },
};

const TOKEN_RE = /\{([a-z_]+)\}/g;

/** Fills a template: optional [[ ]] parts drop when any token inside is empty; spaces tidied. */
export function renderClientCareTemplate(template: string, vars: Partial<Record<ClientCareToken, string | null | undefined>>): string {
  const val = (k: string) => String((vars as Record<string, string | null | undefined>)[k] ?? "").trim();
  const withOptional = String(template ?? "").replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const tokens = [...inner.matchAll(TOKEN_RE)].map((m) => m[1]);
    return tokens.length && tokens.some((k) => !val(k)) ? "" : inner;
  });
  return withOptional
    .replace(TOKEN_RE, (_m, k: string) => val(k))
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,;!?])/g, "$1")
    .trim();
}

/** null when valid, else the problem in plain words. */
export function validateClientCareTemplate(template: string): string | null {
  const t = String(template ?? "");
  if (!t.trim()) return "Template cannot be empty";
  if (t.length > CLIENT_CARE_TEMPLATE_MAX) return `Template is too long (${CLIENT_CARE_TEMPLATE_MAX} characters max)`;
  let depth = 0;
  for (let i = 0; i < t.length - 1; i++) {
    const two = t.slice(i, i + 2);
    if (two === "[[") {
      if (depth) return "Optional parts [[ ]] cannot be nested";
      depth++;
      i++;
    } else if (two === "]]") {
      if (!depth) return "A ]] has no matching [[";
      depth--;
      i++;
    }
  }
  if (depth) return "A [[ is not closed";
  for (const m of t.matchAll(TOKEN_RE)) {
    if (!(CLIENT_CARE_TOKENS as readonly string[]).includes(m[1])) return `Unknown placeholder {${m[1]}}`;
  }
  if (/\{[^}]*$|^[^{]*\}/.test(t.replace(TOKEN_RE, ""))) return "A { or } is not part of a placeholder";
  // The required ones must be outside optional parts, so they always show.
  const outside = t.replace(/\[\[[\s\S]*?\]\]/g, "");
  for (const k of CLIENT_CARE_REQUIRED_TOKENS) if (!outside.includes(`{${k}}`)) return `{${k}} is required (outside [[ ]])`;
  return null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Merge a partial update into a full, valid settings object. */
export function normalizeClientCareSettings(
  input: unknown,
  base: ClientCareSettings = CLIENT_CARE_DEFAULT_SETTINGS,
): { ok: true; settings: ClientCareSettings } | { ok: false; error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s: ClientCareSettings = JSON.parse(JSON.stringify(base));
  const bool = (k: "auto_reply_enabled" | "slack_enabled") => {
    if (b[k] === undefined) return null;
    if (typeof b[k] !== "boolean") return `${k} must be true or false`;
    s[k] = b[k] as boolean;
    return null;
  };
  const int = (k: "remind_after_min" | "escalate_after_min" | "auto_reply_gap_hours" | "staff_quiet_min" | "auto_close_after_days", min: number, max: number) => {
    if (b[k] === undefined) return null;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < min || n > max) return `${k} must be a whole number from ${min} to ${max}`;
    s[k] = n;
    return null;
  };
  const errors = [
    bool("auto_reply_enabled"),
    bool("slack_enabled"),
    int("remind_after_min", 15, 1440),
    int("escalate_after_min", 30, 2880),
    int("auto_reply_gap_hours", 1, 72),
    int("staff_quiet_min", 0, 240),
    int("auto_close_after_days", 0, 30),
  ];
  const first = errors.find(Boolean);
  if (first) return { ok: false, error: first };
  if (b.business_days !== undefined) {
    const days = Array.isArray(b.business_days) ? [...new Set(b.business_days.map(Number))] : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, error: "business_days must be days 0-6 (at least one)" };
    s.business_days = days.sort((x, y) => x - y);
  }
  for (const k of ["business_start", "business_end", "reply_today_until"] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== "string" || !HHMM.test(b[k] as string)) return { ok: false, error: `${k} must be HH:MM (24h)` };
    s[k] = b[k] as string;
  }
  if (minutesOf(s.business_start) >= minutesOf(s.business_end)) return { ok: false, error: "Business hours must end after they start" };
  if (minutesOf(s.reply_today_until) <= minutesOf(s.business_start) || minutesOf(s.reply_today_until) > minutesOf(s.business_end)) {
    return { ok: false, error: "The 'reply today until' time must be within business hours" };
  }
  if (s.escalate_after_min <= s.remind_after_min) return { ok: false, error: "Escalation must come after the reminder" };
  if (b.escalate_admin_ids !== undefined) {
    const ids = Array.isArray(b.escalate_admin_ids) ? [...new Set(b.escalate_admin_ids.map(Number))] : [];
    if (!ids.length || ids.length > 5 || ids.some((n) => !Number.isInteger(n) || n <= 0)) return { ok: false, error: "escalate_admin_ids: 1 to 5 staff ids" };
    s.escalate_admin_ids = ids;
  }
  const t = b.templates as Record<string, Record<string, unknown>> | undefined;
  if (t !== undefined) {
    for (const lang of ["en", "es"] as const) {
      for (const kind of ["message", "missed_call"] as const) {
        const v = t?.[lang]?.[kind];
        if (v === undefined) continue;
        const err = validateClientCareTemplate(String(v));
        if (err) return { ok: false, error: `${lang} ${kind === "message" ? "message" : "missed call"}: ${err}` };
        s.templates[lang][kind] = String(v).trim();
      }
    }
  }
  const w = b.when_labels as Record<string, Record<string, unknown>> | undefined;
  if (w !== undefined) {
    for (const lang of ["en", "es"] as const) {
      for (const k of ["today", "this_morning", "tomorrow_morning", "day_morning"] as const) {
        const v = w?.[lang]?.[k];
        if (v === undefined) continue;
        const text = String(v).trim();
        if (!text || text.length > 40) return { ok: false, error: `${lang} "${k}" must be 1-40 characters` };
        if (k === "day_morning" && !text.includes("{weekday}")) return { ok: false, error: `${lang} "${k}" must include {weekday}` };
        s.when_labels[lang][k] = text;
      }
    }
  }
  return { ok: true, settings: s };
}

/** Business minutes between two LA wall-clock instants (stored as UTC fields). */
export function businessMinutesBetween(fromLa: Date, toLa: Date, settings: ClientCareSettings = CLIENT_CARE_DEFAULT_SETTINGS): number {
  if (!(toLa.getTime() > fromLa.getTime())) return 0;
  const startMin = minutesOf(settings.business_start);
  const endMin = minutesOf(settings.business_end);
  let total = 0;
  const day = new Date(Date.UTC(fromLa.getUTCFullYear(), fromLa.getUTCMonth(), fromLa.getUTCDate()));
  for (let i = 0; i < 400 && day.getTime() <= toLa.getTime(); i++, day.setUTCDate(day.getUTCDate() + 1)) {
    if (!settings.business_days.includes(day.getUTCDay())) continue;
    const open = day.getTime() + startMin * 60_000;
    const close = day.getTime() + endMin * 60_000;
    const a = Math.max(open, fromLa.getTime());
    const b = Math.min(close, toLa.getTime());
    if (b > a) total += (b - a) / 60_000;
  }
  return Math.floor(total);
}

const WEEKDAYS: Record<ClientCareLang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};

/** When the owner will answer, from the business hours: today / this morning / tomorrow morning / {weekday} morning. */
export function clientCareWhen(nowLa: Date, lang: ClientCareLang, settings: ClientCareSettings = CLIENT_CARE_DEFAULT_SETTINGS): string {
  const L = settings.when_labels[lang];
  const mins = nowLa.getUTCHours() * 60 + nowLa.getUTCMinutes();
  const isBizDay = (d: Date) => settings.business_days.includes(d.getUTCDay());
  if (isBizDay(nowLa) && mins < minutesOf(settings.business_start)) return L.this_morning;
  if (isBizDay(nowLa) && mins < minutesOf(settings.reply_today_until)) return L.today;
  const next = new Date(nowLa);
  let guard = 0;
  do next.setUTCDate(next.getUTCDate() + 1);
  while (!isBizDay(next) && ++guard < 8);
  const startOfToday = Date.UTC(nowLa.getUTCFullYear(), nowLa.getUTCMonth(), nowLa.getUTCDate());
  const startOfNext = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  if ((startOfNext - startOfToday) / 86_400_000 === 1) return L.tomorrow_morning;
  return L.day_morning.replace("{weekday}", WEEKDAYS[lang][next.getUTCDay()]);
}

/** "949-736-5644" for a US number; international (+52 …) stays as given. */
export function prettyUsPhone(e164: string | null | undefined): string {
  const raw = String(e164 ?? "").trim();
  if (raw.startsWith("+") && !raw.startsWith("+1")) return raw;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : String(e164 ?? "");
}

/** "Wednesday 11/25" / "miércoles, 25 de noviembre" for a YYYY-MM-DD. */
export function returnDayLabel(ymd: string, lang: ClientCareLang): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return lang === "es"
    ? d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : `${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export interface ClientCareTextInput {
  kind: ClientCareKind;
  lang: ClientCareLang;
  firstName?: string | null;
  topic?: string | null;
  owner: { name: string; phone?: string | null };
  /** The line's owner is out of office (and is not the one answering). */
  away?: { name: string; returnsLabel: string; note?: string | null; autoReply?: string | null } | null;
  when: string;
}

/** The auto-reply / AI hold / missed-call text from the settings' template. */
export function clientCareText(i: ClientCareTextInput, settings: ClientCareSettings = CLIENT_CARE_DEFAULT_SETTINGS): string {
  // The away line owner wrote their own out-of-office text: send it exactly as written.
  const own = String(i.away?.autoReply ?? "").trim();
  if (own) return own;
  const first = String(i.firstName ?? "").trim().split(/\s+/)[0] ?? "";
  return renderClientCareTemplate(settings.templates[i.lang][i.kind], {
    first_name: first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "",
    topic: String(i.topic ?? "").trim().replace(/[.!?]+$/, ""),
    owner: i.owner.name,
    owner_phone: i.owner.phone ? prettyUsPhone(i.owner.phone) : "",
    when: i.when,
    away_name: i.away?.name ?? "",
    return_day: i.away?.returnsLabel ?? "",
    away_note: i.away?.note ?? "",
  });
}
