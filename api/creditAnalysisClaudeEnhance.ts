/**
 * Pure helpers: merge Claude drafts into pre-sale credit analysis.
 * Scores / utilization numbers / account identities / CROA are never overwritten.
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * copy in api/index.ts.
 */
import type { CreditAnalysisAnalystFlat } from "../shared/api";

export type CreditAnalysisClaudeDraft = {
  fha_status?: string;
  goal_description?: string;
  utilization_critical_note?: string;
  paydown_30_instruction?: string;
  paydown_10_instruction?: string;
  target_timeframe?: string;
  round_1_actions?: string;
  round_2_actions?: string;
  round_3_actions?: string;
  positive_accounts_protect?: string;
  tradeline_recommendation?: string;
  client_text_message?: string;
  action_plan?: Array<{
    time?: string;
    action?: string;
    reason?: string;
  }>;
  neg_dispute_basis?: Array<{
    /** Match existing neg_N_account */
    account?: string;
    dispute_basis?: string;
  }>;
  fs_notes?: {
    open_revolving?: string;
    installment_mix?: string;
    mortgage?: string;
    account_age?: string;
    post_repair?: string;
  };
};

export const CREDIT_ANALYSIS_CLAUDE_SYSTEM = `You are the OFG pre-sale Credit Analysis narrative writer for Optimum Financial Group (Newport Beach, CA).
You receive a rules-engine extraction (scores, negatives, utilization, draft plan). Improve the narrative only.

Compliance (non-negotiable):
- Do NOT invent bureau scores, accounts, balances, or utilization numbers
- Do NOT invent negative accounts that are not in the input
- Do NOT change numeric score fields or priority labels (CRITICAL/HIGH/MEDIUM/LOWER)
- NO score guarantees — use "projected" or "estimated"
- Tradeline identities: never invent cardholder names; codes like IH-1 only if already present
- Dispute stages: label "Round 1"–"Round 4" ONLY — no "Week 1", "Month 2", "in 30 days" timing language
- Include legal citations where relevant: FCRA §604, §611, §623; FDCPA §809
- Match language: English or Spanish from input text_language (Spanish | English) — no Spanglish
- CROA disclosure is added separately — do not rewrite it

Return ONLY a JSON object (no markdown) with optional keys:
{
  "fha_status": "...",
  "goal_description": "...",
  "utilization_critical_note": "...",
  "paydown_30_instruction": "...",
  "paydown_10_instruction": "...",
  "target_timeframe": "...",
  "round_1_actions": "★ first action\\n★ second action (JSON newlines OK; never leave backslash-n as visible text)",
  "round_2_actions": "★ ...",
  "round_3_actions": "★ ...",
  "positive_accounts_protect": "...",
  "tradeline_recommendation": "...",
  "client_text_message": "SMS-ready, under 320 chars, include optimum-financial-group.com if present in input",
  "action_plan": [
    { "time": "Round 1", "action": "...", "reason": "..." }
  ],
  "neg_dispute_basis": [
    { "account": "<exact match to existing>", "dispute_basis": "..." }
  ],
  "fs_notes": {
    "open_revolving": "full fs_open_revolving string or justification after —",
    "installment_mix": "...",
    "mortgage": "...",
    "account_age": "...",
    "post_repair": "..."
  }
}

Round assignment guidance (OFG engine):
- Round 1: duplicate/unverifiable inquiries
- Round 2: collection / third-party debt
- Round 3: bureau inconsistencies
- Round 4: charge-offs / complex 90+ late consistently reported
Keep action_plan to 4–6 steps. Prefer Round labels over calendar timing.`;

/** Keep in sync with api/index.ts decodeLiteralUnicodeEscapes. */
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

function clip(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = decodeLiteralUnicodeEscapes(s.trim());
  if (!t) return null;
  return t.slice(0, max);
}

function sanitizeActionTimeLabel(time: string, preferEs: boolean): string {
  const raw = String(time || "").trim();
  const round = (n: string) => (preferEs ? `Ronda ${n}` : `Round ${n}`);
  const m = raw.match(/(?:round|ronda)\s*([1-4])/i);
  if (m) return round(m[1]);
  if (/90\s*d|90\s*day/i.test(raw)) return round("3");
  if (/60\s*d|60\s*day/i.test(raw)) return round("2");
  if (/30\s*d|30\s*day/i.test(raw)) return round("1");
  if (/week|month|semana|mes|in\s+\d+\s*days/i.test(raw)) return round("1");
  if (!raw || !/^(round|ronda)\s*[1-4]$/i.test(raw)) return round("1");
  return raw;
}

function applyFsNote(
  current: string,
  note: string | null | undefined,
): string {
  const n = clip(note, 220);
  if (!n) return current;
  // Allow full replacement or "score/max — note" style
  if (/^\d+\/\d+/.test(n) || n.includes("—") || n.includes("-")) return n;
  const m = current.match(/^(\d+\/\d+)\s*[—\-]\s*/);
  if (m) return `${m[1]} — ${n}`;
  return n;
}

/** Merge Claude draft onto analyst flat — never mutates scores/util numbers/accounts. */
export function mergeCreditAnalysisClaudeEnhancement(
  base: CreditAnalysisAnalystFlat,
  draft: CreditAnalysisClaudeDraft | null | undefined,
): CreditAnalysisAnalystFlat {
  if (!draft || typeof draft !== "object") return base;
  const out: CreditAnalysisAnalystFlat = { ...base };

  const strFields: Array<[keyof CreditAnalysisAnalystFlat, keyof CreditAnalysisClaudeDraft, number]> = [
    ["fha_status", "fha_status", 240],
    ["goal_description", "goal_description", 280],
    ["utilization_critical_note", "utilization_critical_note", 280],
    ["paydown_30_instruction", "paydown_30_instruction", 280],
    ["paydown_10_instruction", "paydown_10_instruction", 280],
    ["target_timeframe", "target_timeframe", 160],
    ["round_1_actions", "round_1_actions", 800],
    ["round_2_actions", "round_2_actions", 800],
    ["round_3_actions", "round_3_actions", 800],
    ["positive_accounts_protect", "positive_accounts_protect", 400],
    ["tradeline_recommendation", "tradeline_recommendation", 400],
    ["client_text_message", "client_text_message", 480],
  ];
  for (const [dest, src, max] of strFields) {
    const v = clip(draft[src], max);
    if (v) (out as any)[dest] = v;
  }

  if (Array.isArray(draft.action_plan) && draft.action_plan.length > 0) {
    const steps = draft.action_plan.slice(0, 6);
    const preferEs = /ronda|español|¡|ñ/i.test(
      String(base.round_1_actions || base.client_text_message || ""),
    );
    for (let i = 0; i < 6; i++) {
      const step = steps[i];
      const n = i + 1;
      if (!step) continue;
      const time = clip(step.time, 40);
      const action = clip(step.action, 220);
      const reason = clip(step.reason, 220);
      if (time)
        (out as any)[`action_${n}_time`] = sanitizeActionTimeLabel(
          time,
          preferEs,
        );
      if (action) (out as any)[`action_${n}_action`] = action;
      if (reason) (out as any)[`action_${n}_reason`] = reason;
    }
  }

  if (Array.isArray(draft.neg_dispute_basis)) {
    for (const row of draft.neg_dispute_basis) {
      const account = clip(row.account, 80);
      const basis = clip(row.dispute_basis, 280);
      if (!account || !basis) continue;
      const key = account.toLowerCase();
      for (let i = 1; i <= 5; i++) {
        const acc = String((out as any)[`neg_${i}_account`] || "");
        if (acc && acc.toLowerCase() === key) {
          (out as any)[`neg_${i}_dispute_basis`] = basis;
          break;
        }
      }
    }
  }

  if (draft.fs_notes && typeof draft.fs_notes === "object") {
    const asStr = (v: string | number | null | undefined) =>
      v == null ? "" : String(v);
    out.fs_open_revolving = applyFsNote(
      asStr(out.fs_open_revolving),
      draft.fs_notes.open_revolving,
    );
    out.fs_installment_mix = applyFsNote(
      asStr(out.fs_installment_mix),
      draft.fs_notes.installment_mix,
    );
    out.fs_mortgage = applyFsNote(
      asStr(out.fs_mortgage),
      draft.fs_notes.mortgage,
    );
    out.fs_account_age = applyFsNote(
      asStr(out.fs_account_age),
      draft.fs_notes.account_age,
    );
    out.fs_post_repair = applyFsNote(
      asStr(out.fs_post_repair),
      draft.fs_notes.post_repair,
    );
  }

  return out;
}

export function parseCreditAnalysisClaudeJson(
  text: string,
): CreditAnalysisClaudeDraft | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) return null;
    return JSON.parse(objMatch[0]) as CreditAnalysisClaudeDraft;
  } catch {
    return null;
  }
}

/** Rebuild action_plan_html rows from flat action_* fields (no navy colors — caller may wrap). */
export function actionPlanRowsFromAnalyst(
  a: CreditAnalysisAnalystFlat,
): Array<{ time: string; action: string; reason: string }> {
  const rows: Array<{ time: string; action: string; reason: string }> = [];
  for (let i = 1; i <= 6; i++) {
    const time = String((a as any)[`action_${i}_time`] || "").trim();
    const action = String((a as any)[`action_${i}_action`] || "").trim();
    const reason = String((a as any)[`action_${i}_reason`] || "").trim();
    if (!time && !action) continue;
    rows.push({ time, action, reason });
  }
  return rows;
}
