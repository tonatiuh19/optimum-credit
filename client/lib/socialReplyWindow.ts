import type { SocialReplyWindow } from "@shared/api";

const HOUR = 3600_000;

export type SocialReplyWindowState = { window: SocialReplyWindow; msLeft: number | null };

/**
 * Live reply window from the server's snapshot: the list row may be minutes old, so a
 * standard window that has run out rolls into Human Agent (7 days from their last DM,
 * i.e. 6 days after the 24h mark), and an expired Human Agent window closes.
 */
export function socialReplyWindowState(
  window: SocialReplyWindow | null | undefined,
  endsAt: string | null | undefined,
  nowMs = Date.now(),
): SocialReplyWindowState | null {
  if (!window) return null;
  if (window === "closed") return { window: "closed", msLeft: null };
  const end = endsAt ? Date.parse(endsAt) : NaN;
  if (!Number.isFinite(end)) return { window, msLeft: null };
  if (nowMs < end) return { window, msLeft: end - nowMs };
  if (window === "standard") {
    const humanEnd = end + 6 * 24 * HOUR;
    return nowMs < humanEnd ? { window: "human_agent", msLeft: humanEnd - nowMs } : { window: "closed", msLeft: null };
  }
  return { window: "closed", msLeft: null };
}

/** Compact time left: "45m", "18h", "5d". */
export function formatWindowLeft(msLeft: number): { unit: "minutes" | "hours" | "days"; count: number } {
  if (msLeft < HOUR) return { unit: "minutes", count: Math.max(1, Math.ceil(msLeft / 60_000)) };
  if (msLeft < 48 * HOUR) return { unit: "hours", count: Math.floor(msLeft / HOUR) };
  return { unit: "days", count: Math.floor(msLeft / (24 * HOUR)) };
}
