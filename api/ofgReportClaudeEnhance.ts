/**
 * Pure helpers: merge Claude narrative drafts into OfG report data.
 * Scores / utilization numbers / CROA are never overwritten by Claude.
 */
import type { OfGReportData } from "../shared/api";

export type ClaudeNarrativeDraft = {
  wins?: Array<{
    itemRemoved?: string;
    impact?: string;
    status?: string;
  }>;
  targets?: Array<{
    item?: string;
    detail?: string;
    priority?: "high" | "medium" | "low";
  }>;
  actionPlan?: Array<{
    step?: number;
    description?: string;
    owner?: "ofg" | "client";
  }>;
  roadmap?: {
    milestones?: string[];
    scoreGoal?: number;
    gapRemaining?: number;
  };
  positiveAccounts?: string[];
  actionNeeded?: string[];
  fundingReadinessNote?: string | null;
  tradelineRecommendation?: {
    code?: string;
    projectedImpact?: string;
  } | null;
};

export const OFG_CLAUDE_NARRATIVE_SYSTEM = `You are the OFG Progress Report narrative writer for Optimum Financial Group (Newport Beach, CA).
Tone: encouraging, results-focused, professional.
Compliance (non-negotiable):
- Factual results only — what was removed / still reporting
- NO goodwill letters, NO payoff advice, NO debt negotiation
- NO score guarantees — use "projected" or "on track for"
- Tradeline codes only as IH-1, IH-2, etc. — NEVER cardholder names
- Do NOT invent removals, scores, or accounts that are not in the input

Return ONLY a JSON object (no markdown) with optional keys:
{
  "wins": [{ "itemRemoved": "<match existing>", "impact": "...", "status": "..." }],
  "targets": [{ "item": "<match existing>", "detail": "...", "priority": "high"|"medium"|"low" }],
  "actionPlan": [{ "step": 1, "description": "...", "owner": "ofg"|"client" }],  // 3–5 steps
  "roadmap": { "milestones": ["..."], "scoreGoal": number, "gapRemaining": number },
  "positiveAccounts": ["..."],
  "actionNeeded": ["..."],
  "fundingReadinessNote": "..." | null,
  "tradelineRecommendation": { "code": "IH-1", "projectedImpact": "..." } | null
}

Match wins/targets to existing itemRemoved/item strings when improving wording.
Keep locale (en/es) from the input report.locale.`;

function decodeLiteralUnicodeEscapes(input: string): string {
  if (!input || !input.includes("\\")) return input;
  if (!/\\[nrtu]/.test(input)) return input;
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function clipDecodedStr(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = decodeLiteralUnicodeEscapes(s.trim());
  if (!t) return null;
  return t.slice(0, max);
}

function normKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Merge Claude draft onto base — never mutates scores/utilization/CROA/client. */
export function mergeClaudeNarrativeEnhancement(
  base: OfGReportData,
  draft: ClaudeNarrativeDraft | null | undefined,
): OfGReportData {
  if (!draft || typeof draft !== "object") return base;

  const wins = base.wins.map((w) => {
    const byKey = (draft.wins || []).find(
      (d) =>
        d.itemRemoved &&
        normKey(d.itemRemoved) === normKey(w.itemRemoved),
    );
    if (!byKey) return w;
    return {
      ...w,
      impact: clipDecodedStr(byKey.impact, 160) || w.impact,
      status: clipDecodedStr(byKey.status, 80) || w.status,
    };
  });

  const targets = base.targets.map((t) => {
    const byKey = (draft.targets || []).find(
      (d) => d.item && normKey(d.item) === normKey(t.item),
    );
    if (!byKey) return t;
    const priority =
      byKey.priority === "high" ||
      byKey.priority === "medium" ||
      byKey.priority === "low"
        ? byKey.priority
        : t.priority;
    return {
      ...t,
      detail: clipDecodedStr(byKey.detail, 200) || t.detail,
      priority,
    };
  });

  let actionPlan = base.actionPlan;
  if (Array.isArray(draft.actionPlan) && draft.actionPlan.length > 0) {
    actionPlan = draft.actionPlan
      .slice(0, 5)
      .map((a, idx) => ({
        step: Number(a.step) > 0 ? Number(a.step) : idx + 1,
        description: clipDecodedStr(a.description, 220) || "",
        owner: (a.owner === "client" ? "client" : "ofg") as "client" | "ofg",
      }))
      .filter((a) => a.description.length > 0);
    if (!actionPlan.length) actionPlan = base.actionPlan;
  }

  const roadmap = { ...base.roadmap };
  if (draft.roadmap) {
    // Never overwrite numeric score goals from Claude — only milestone copy.
    if (Array.isArray(draft.roadmap.milestones) && draft.roadmap.milestones.length) {
      roadmap.milestones = draft.roadmap.milestones
        .map((m) => clipDecodedStr(m, 120))
        .filter((m): m is string => !!m)
        .slice(0, 6);
    }
  }

  const positiveAccounts = Array.isArray(draft.positiveAccounts)
    ? draft.positiveAccounts
        .map((s) => clipDecodedStr(s, 120))
        .filter((s): s is string => !!s)
        .slice(0, 8)
    : base.positiveAccounts;
  const actionNeeded = Array.isArray(draft.actionNeeded)
    ? draft.actionNeeded
        .map((s) => clipDecodedStr(s, 160))
        .filter((s): s is string => !!s)
        .slice(0, 8)
    : base.actionNeeded;

  let fundingReadinessNote = base.fundingReadinessNote;
  if (draft.fundingReadinessNote === null) {
    fundingReadinessNote = undefined;
  } else if (
    typeof draft.fundingReadinessNote === "string" &&
    draft.fundingReadinessNote.trim()
  ) {
    fundingReadinessNote =
      clipDecodedStr(draft.fundingReadinessNote, 280) || undefined;
  }

  let tradelineRecommendation = base.tradelineRecommendation;
  if (draft.tradelineRecommendation === null) {
    tradelineRecommendation = undefined;
  } else if (
    draft.tradelineRecommendation &&
    typeof draft.tradelineRecommendation.code === "string"
  ) {
    const code = draft.tradelineRecommendation.code.trim().toUpperCase();
    if (/^IH-\d+$/i.test(code)) {
      tradelineRecommendation = {
        code,
        projectedImpact:
          clipDecodedStr(
            draft.tradelineRecommendation.projectedImpact ||
              base.tradelineRecommendation?.projectedImpact ||
              "",
            200,
          ) || "",
      };
    }
  }

  return {
    ...base,
    wins,
    targets,
    actionPlan,
    roadmap,
    positiveAccounts: positiveAccounts.length
      ? positiveAccounts
      : base.positiveAccounts,
    actionNeeded: actionNeeded.length ? actionNeeded : base.actionNeeded,
    fundingReadinessNote,
    tradelineRecommendation,
  };
}

export function parseClaudeNarrativeJson(
  text: string,
): ClaudeNarrativeDraft | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    return JSON.parse(objMatch[0]) as ClaudeNarrativeDraft;
  } catch {
    return null;
  }
}

/** Claude fallback when deterministic bureau score extract is incomplete. */
export type ClaudeBureauScoresDraft = {
  before?: {
    transunion?: number | null;
    experian?: number | null;
    equifax?: number | null;
  };
  after?: {
    transunion?: number | null;
    experian?: number | null;
    equifax?: number | null;
  };
  reportDate?: { before?: string | null; after?: string | null };
};

export const OFG_CLAUDE_SCORE_EXTRACT_SYSTEM = `You extract ONLY credit bureau scores and report dates from tri-merge PDF text for Optimum Financial Group.
Rules (non-negotiable):
- Return ONLY JSON (no markdown)
- Scores must be integers 300–850 from the PDF text — NEVER invent or guess
- If a bureau score is not clearly present, use null
- Prefer VantageScore / FICO / "Credit Score and Rating" blocks over balances, limits, or $ amounts
- reportDate values must be YYYY-MM-DD when a clear report date exists, else null

JSON shape:
{
  "before": { "transunion": number|null, "experian": number|null, "equifax": number|null },
  "after": { "transunion": number|null, "experian": number|null, "equifax": number|null },
  "reportDate": { "before": "YYYY-MM-DD"|null, "after": "YYYY-MM-DD"|null }
}`;

function clampBureauScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return null;
  if (v < 300 || v > 850) return null;
  return v;
}

export function parseClaudeBureauScoresJson(
  text: string,
): ClaudeBureauScoresDraft | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    return JSON.parse(objMatch[0]) as ClaudeBureauScoresDraft;
  } catch {
    return null;
  }
}

/** True when any bureau before/after is missing (0/null) or confidence is low. */
export function needsClaudeScoreFallback(
  data: OfGReportData,
  confidence?: Record<string, number> | null,
): boolean {
  const bureaus = ["transunion", "experian", "equifax"] as const;
  for (const b of bureaus) {
    const before = data.bureauScores[b]?.before ?? 0;
    const after = data.bureauScores[b]?.after ?? 0;
    if (!before || !after) return true;
    if (confidence && (confidence[b] ?? 0) < 0.6) return true;
  }
  return false;
}

/**
 * Fill only missing (0/null) bureau scores from Claude. Never overwrite
 * deterministic non-zero scores. Returns which fields were filled.
 */
export function mergeClaudeBureauScores(
  data: OfGReportData,
  draft: ClaudeBureauScoresDraft | null | undefined,
  opts?: { fillDates?: boolean },
): { data: OfGReportData; filled: string[] } {
  if (!draft || typeof draft !== "object") {
    return { data, filled: [] };
  }
  const filled: string[] = [];
  const next: OfGReportData = {
    ...data,
    bureauScores: {
      transunion: { ...data.bureauScores.transunion },
      experian: { ...data.bureauScores.experian },
      equifax: { ...data.bureauScores.equifax },
    },
    middleScore: { ...data.middleScore },
    reportDate: { ...data.reportDate },
  };
  const sides = ["before", "after"] as const;
  const bureaus = ["transunion", "experian", "equifax"] as const;
  for (const side of sides) {
    const block = draft[side];
    if (!block || typeof block !== "object") continue;
    for (const b of bureaus) {
      const current = next.bureauScores[b][side] ?? 0;
      if (current > 0) continue;
      const v = clampBureauScore(block[b]);
      if (v == null) continue;
      next.bureauScores[b][side] = v;
      filled.push(`${side}.${b}`);
    }
  }
  if (opts?.fillDates && draft.reportDate) {
    for (const side of sides) {
      const iso = String(draft.reportDate[side] || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      // Only replace when date was missing / same-day fallback placeholder
      // (caller decides via fillDates).
      next.reportDate[side] = iso;
      filled.push(`reportDate.${side}`);
    }
  }

  const midBefore = [next.bureauScores.transunion.before, next.bureauScores.experian.before, next.bureauScores.equifax.before]
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  const midAfter = [next.bureauScores.transunion.after, next.bureauScores.experian.after, next.bureauScores.equifax.after]
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  if (midBefore.length) {
    next.middleScore.before = midBefore[Math.floor(midBefore.length / 2)];
  }
  if (midAfter.length) {
    next.middleScore.after = midAfter[Math.floor(midAfter.length / 2)];
  }

  return { data: next, filled };
}
