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
      impact:
        typeof byKey.impact === "string" && byKey.impact.trim()
          ? byKey.impact.trim().slice(0, 160)
          : w.impact,
      status:
        typeof byKey.status === "string" && byKey.status.trim()
          ? byKey.status.trim().slice(0, 80)
          : w.status,
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
      detail:
        typeof byKey.detail === "string" && byKey.detail.trim()
          ? byKey.detail.trim().slice(0, 200)
          : t.detail,
      priority,
    };
  });

  let actionPlan = base.actionPlan;
  if (Array.isArray(draft.actionPlan) && draft.actionPlan.length > 0) {
    actionPlan = draft.actionPlan
      .slice(0, 5)
      .map((a, idx) => ({
        step: Number(a.step) > 0 ? Number(a.step) : idx + 1,
        description: String(a.description || "")
          .trim()
          .slice(0, 220),
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
        .map((m) => String(m).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 6);
    }
  }

  const positiveAccounts = Array.isArray(draft.positiveAccounts)
    ? draft.positiveAccounts
        .map((s) => String(s).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 8)
    : base.positiveAccounts;
  const actionNeeded = Array.isArray(draft.actionNeeded)
    ? draft.actionNeeded
        .map((s) => String(s).trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 8)
    : base.actionNeeded;

  let fundingReadinessNote = base.fundingReadinessNote;
  if (draft.fundingReadinessNote === null) {
    fundingReadinessNote = undefined;
  } else if (
    typeof draft.fundingReadinessNote === "string" &&
    draft.fundingReadinessNote.trim()
  ) {
    fundingReadinessNote = draft.fundingReadinessNote.trim().slice(0, 280);
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
        projectedImpact: String(
          draft.tradelineRecommendation.projectedImpact ||
            base.tradelineRecommendation?.projectedImpact ||
            "",
        )
          .trim()
          .slice(0, 200),
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
