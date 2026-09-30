/**
 * Client helpers for OFG dual-wins JSON + compare mode (aligned with api/reportCompareMode.ts).
 */

export type ReportCompareMode = "baseline" | "chain";

export function normalizeReportCompareMode(raw: unknown): ReportCompareMode {
  return String(raw || "").toLowerCase() === "chain" ? "chain" : "baseline";
}

export type PortalWinRow = {
  itemRemoved?: string;
  item?: string;
  bureaus?: string[];
  impact?: string;
  status?: string;
  detail?: string;
  priority?: string;
};

export function parsePortalDualList(raw: unknown): {
  thisRound: PortalWinRow[];
  sinceEnrollment: PortalWinRow[];
  compareMode: ReportCompareMode | null;
} {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { thisRound: [], sinceEnrollment: [], compareMode: null };
    }
  }
  if (Array.isArray(parsed)) {
    const list = parsed as PortalWinRow[];
    return { thisRound: list, sinceEnrollment: list, compareMode: null };
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const thisRound = Array.isArray(o.this_round)
      ? (o.this_round as PortalWinRow[])
      : [];
    const sinceEnrollment = Array.isArray(o.since_enrollment)
      ? (o.since_enrollment as PortalWinRow[])
      : thisRound;
    return {
      thisRound,
      sinceEnrollment,
      compareMode: o.compare_mode
        ? normalizeReportCompareMode(o.compare_mode)
        : null,
    };
  }
  return { thisRound: [], sinceEnrollment: [], compareMode: null };
}
