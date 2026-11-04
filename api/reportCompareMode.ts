/**
 * OFG progress-report compare mode helpers.
 * Keep in sync with inlined copies in api/index.ts (Vercel: no sibling runtime import).
 */

export type ReportCompareMode = "baseline" | "chain";

export function normalizeReportCompareMode(raw: unknown): ReportCompareMode {
  return String(raw || "").toLowerCase() === "chain" ? "chain" : "baseline";
}

export type OfGWinRow = {
  itemRemoved: string;
  bureaus: ("TU" | "EX" | "EQ")[];
  impact: string;
  status: string;
  highlighted?: boolean;
};

export type OfGTargetRow = {
  item: string;
  bureaus: ("TU" | "EX" | "EQ")[];
  detail: string;
  priority: "high" | "medium" | "low";
};

/** Pick primary wins array for PDF/back-compat `wins` field. */
export function primaryWinsForMode(
  mode: ReportCompareMode,
  thisRound: OfGWinRow[],
  sinceEnrollment: OfGWinRow[],
): OfGWinRow[] {
  return mode === "chain" ? thisRound : sinceEnrollment;
}

export function primaryTargetsForMode(
  mode: ReportCompareMode,
  thisRound: OfGTargetRow[],
  sinceEnrollment: OfGTargetRow[],
): OfGTargetRow[] {
  return mode === "chain" ? thisRound : sinceEnrollment;
}

/**
 * Persist shape for wins_json / targets_json (v2 dual tables).
 * Readers must accept legacy plain arrays too.
 */
export function serializeDualWinsJson(opts: {
  compareMode: ReportCompareMode;
  thisRound: OfGWinRow[];
  sinceEnrollment: OfGWinRow[];
}): Record<string, unknown> {
  return {
    v: 2,
    compare_mode: opts.compareMode,
    this_round: opts.thisRound,
    since_enrollment: opts.sinceEnrollment,
  };
}

export function serializeDualTargetsJson(opts: {
  compareMode: ReportCompareMode;
  thisRound: OfGTargetRow[];
  sinceEnrollment: OfGTargetRow[];
}): Record<string, unknown> {
  return {
    v: 2,
    compare_mode: opts.compareMode,
    this_round: opts.thisRound,
    since_enrollment: opts.sinceEnrollment,
  };
}

export function parseDualWinsJson(raw: unknown): {
  thisRound: OfGWinRow[];
  sinceEnrollment: OfGWinRow[];
  compareMode: ReportCompareMode | null;
} {
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  if (Array.isArray(parsed)) {
    const list = parsed as OfGWinRow[];
    return { thisRound: list, sinceEnrollment: list, compareMode: null };
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const thisRound = Array.isArray(o.this_round)
      ? (o.this_round as OfGWinRow[])
      : [];
    const sinceEnrollment = Array.isArray(o.since_enrollment)
      ? (o.since_enrollment as OfGWinRow[])
      : thisRound;
    return {
      thisRound,
      sinceEnrollment,
      compareMode: normalizeReportCompareMode(o.compare_mode),
    };
  }
  return { thisRound: [], sinceEnrollment: [], compareMode: null };
}

export function parseDualTargetsJson(raw: unknown): {
  thisRound: OfGTargetRow[];
  sinceEnrollment: OfGTargetRow[];
  compareMode: ReportCompareMode | null;
} {
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  if (Array.isArray(parsed)) {
    const list = parsed as OfGTargetRow[];
    return { thisRound: list, sinceEnrollment: list, compareMode: null };
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const thisRound = Array.isArray(o.this_round)
      ? (o.this_round as OfGTargetRow[])
      : [];
    const sinceEnrollment = Array.isArray(o.since_enrollment)
      ? (o.since_enrollment as OfGTargetRow[])
      : thisRound;
    return {
      thisRound,
      sinceEnrollment,
      compareMode: normalizeReportCompareMode(o.compare_mode),
    };
  }
  return { thisRound: [], sinceEnrollment: [], compareMode: null };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Project extended round target dates from R5 + interval (or overrides). */
export function projectExtendedRoundDates(opts: {
  round5Date: string;
  intervalDays: number;
  maxRounds: number;
  overrides?: Record<string, string> | null;
}): Array<{ round: number; date: string }> {
  const max = Math.min(24, Math.max(5, Math.floor(Number(opts.maxRounds) || 5)));
  if (max <= 5) return [];
  const interval = Math.max(1, Math.floor(Number(opts.intervalDays) || 35));
  const base = parseYmd(opts.round5Date);
  if (!base) return [];
  const out: Array<{ round: number; date: string }> = [];
  const overrides = opts.overrides || {};
  for (let r = 6; r <= max; r++) {
    const key = String(r);
    if (overrides[key] && /^\d{4}-\d{2}-\d{2}$/.test(overrides[key])) {
      out.push({ round: r, date: overrides[key] });
      continue;
    }
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + interval * (r - 5));
    out.push({ round: r, date: formatYmd(d) });
  }
  return out;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Reminder flow trigger for a published round number. */
export function reminderTriggerForRound(roundNumber: number): string {
  const n = Math.floor(Number(roundNumber) || 0);
  if (n >= 1 && n <= 5) return `round_${n}_complete`;
  if (n > 5) return "round_extended_complete";
  return `round_${n}_complete`;
}
