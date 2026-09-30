/**
 * Conversations inbox / timeline relative timestamps.
 * "Today at 1:35 PM", "Yesterday", "3 days ago", etc.
 */
import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isValid,
  parseISO,
  subDays,
} from "date-fns";
import { enUS, es } from "date-fns/locale";

export type ConversationTimeLang = "en" | "es";

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === "string" ? parseISO(input) : input;
  return isValid(d) ? d : null;
}

function localeFor(lang: ConversationTimeLang) {
  return lang === "es" ? es : enUS;
}

/** Calendar-day equality relative to an injected `now` (not the wall clock). */
function sameCalendarDay(a: Date, b: Date): boolean {
  return differenceInCalendarDays(a, b) === 0;
}

/** Absolute clock for "Today at …" / hover tooltips. */
export function formatConversationClock(
  date: Date,
  lang: ConversationTimeLang = "en",
): string {
  return format(date, lang === "es" ? "h:mm a" : "h:mm a", {
    locale: localeFor(lang),
  });
}

/**
 * Short relative label for inbox rows.
 * Pass `now` in tests for stable output.
 */
export function formatConversationListTime(
  input: string | Date | null | undefined,
  opts?: { lang?: ConversationTimeLang; now?: Date },
): string {
  const date = toDate(input);
  if (!date) return "";
  const lang = opts?.lang === "es" ? "es" : "en";
  const now = opts?.now && isValid(opts.now) ? opts.now : new Date();
  const mins = differenceInMinutes(now, date);

  if (mins < 0) {
    // Clock skew / future — show clock today-style
    return lang === "es"
      ? `Hoy a las ${formatConversationClock(date, lang)}`
      : `Today at ${formatConversationClock(date, lang)}`;
  }
  if (mins < 1) {
    return lang === "es" ? "Ahora mismo" : "Just now";
  }
  if (mins < 60) {
    return lang === "es" ? `Hace ${mins} min` : `${mins}m ago`;
  }

  // Use `now`, not date-fns isToday/isYesterday (those ignore injected now).
  if (sameCalendarDay(date, now)) {
    const clock = formatConversationClock(date, lang);
    return lang === "es" ? `Hoy a las ${clock}` : `Today at ${clock}`;
  }
  if (sameCalendarDay(date, subDays(now, 1))) {
    const clock = formatConversationClock(date, lang);
    return lang === "es" ? `Ayer a las ${clock}` : `Yesterday at ${clock}`;
  }

  const days = differenceInCalendarDays(now, date);
  if (days >= 2 && days < 7) {
    return lang === "es" ? `Hace ${days} días` : `${days} days ago`;
  }

  // Older: compact calendar date
  const sameYear = date.getFullYear() === now.getFullYear();
  return format(
    date,
    sameYear
      ? lang === "es"
        ? "d MMM"
        : "MMM d"
      : lang === "es"
        ? "d MMM yyyy"
        : "MMM d, yyyy",
    { locale: localeFor(lang) },
  );
}

/** Full absolute stamp for title/tooltip. */
export function formatConversationAbsoluteTime(
  input: string | Date | null | undefined,
  lang: ConversationTimeLang = "en",
): string {
  const date = toDate(input);
  if (!date) return "";
  return format(date, lang === "es" ? "EEE d MMM yyyy, h:mm a" : "EEE, MMM d yyyy, h:mm a", {
    locale: localeFor(lang),
  });
}
