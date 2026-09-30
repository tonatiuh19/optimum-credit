/**
 * OFG Credit Analysis Engine — pure classification / projection helpers.
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * `*Inline` copies in api/index.ts.
 *
 * Spec: docs attachment OFG_Credit_Analysis_Engine_Spec.pdf §§3–11
 */

export type DisputeRound = 1 | 2 | 3 | 4;
export type ProgramTier = "standard" | "complex";

export type EngineNegativeInput = {
  type: string;
  creditor?: string;
  bureaus?: string[];
  detail?: string;
  /** Approx first derogatory event (ISO or loose). */
  derogatory_date?: string | null;
  comments?: string;
};

export type EngineRankedNeg = {
  account: string;
  type: string;
  bureaus: string;
  bureau_count: number;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOWER";
  dispute_basis: string;
  dispute_round: DisputeRound;
  derogatory_date: string | null;
  score_lift: number;
};

const COLLECTION_AGENCY_HINT =
  /\b(midland|portfolio recovery|lvnv|resurgent|cavalry|asset acceptance|enhanced recovery|ic system|collection|placed for collection|purchased debt|debt buyer)\b/i;

const COMPLEX_TIER_HINT =
  /\b(bankrupt|repossession|repossessed|\brepo\b|foreclos|tax\s*lien|irs\b|sba\b|student\s*loan|navient|sallie mae|dept\.?\s*of\s*education|medical|hospital|clinic)/i;

const INSTALLMENT_UTIL_EXCLUDE =
  /\b(installment|auto\s*loan|vehicle|mortgage|heloc|home\s*equity|student|personal\s*loan)\b/i;

/** Approx points recovered if this item is successfully disputed/removed (FICO-ish heuristic). */
export function estimateDisputeScoreLift(input: EngineNegativeInput): number {
  const hay = `${input.type} ${input.creditor || ""} ${input.detail || ""} ${input.comments || ""}`;
  if (/bankrupt|foreclos|repossess|tax\s*lien|judgment/i.test(hay)) return 45;
  if (/charge.?off|charged off/i.test(hay)) return 35;
  if (/collection/i.test(hay)) return 28;
  if (/90\+|120|150/i.test(hay) && /late|delinquen|past due/i.test(hay))
    return 22;
  if (/late|past due|delinquen/i.test(hay)) return 12;
  if (/inqui/i.test(hay)) return 8;
  return 10;
}

export function assignDisputeRound(
  input: EngineNegativeInput,
  opts?: { triBureau?: boolean },
): DisputeRound {
  const hay = `${input.type} ${input.creditor || ""} ${input.detail || ""} ${input.comments || ""}`;
  const bureauCount = input.bureaus?.length
    ? input.bureaus.length
    : countBureausInHay(hay);

  // Round 1 — inquiries (duplicate / unverifiable)
  if (/inqui/i.test(hay)) return 1;

  // Round 2 — collections / third-party debt
  if (
    /collection/i.test(hay) ||
    COLLECTION_AGENCY_HINT.test(hay) ||
    /placed for collection|purchased debt/i.test(hay)
  ) {
    return 2;
  }

  // Round 3 — bureau inconsistencies (missing on one, or consumer dispute flag)
  const inconsistency =
    (opts?.triBureau && bureauCount > 0 && bureauCount < 3) ||
    /consumer disputes|disputes this information|inconsisten/i.test(hay);
  if (inconsistency) return 3;

  // Round 4 — charge-offs / 90+ consistently reported
  if (
    /charge.?off|charged off/i.test(hay) ||
    (/90\+|120|150/i.test(hay) && /late|delinquen|past due/i.test(hay))
  ) {
    return 4;
  }

  // Default unclear derogatories → Round 3 (bureau inconsistency review)
  return 3;
}

function countBureausInHay(hay: string): number {
  let n = 0;
  if (/\b(TU|TransUnion)\b/i.test(hay)) n++;
  if (/\b(EX|Experian)\b/i.test(hay)) n++;
  if (/\b(EQ|Equifax)\b/i.test(hay)) n++;
  return n;
}

export function classifyProgramTier(
  negatives: EngineNegativeInput[],
  reportText = "",
): ProgramTier {
  const hay = `${negatives.map((n) => `${n.type} ${n.creditor || ""} ${n.detail || ""} ${n.comments || ""}`).join(" ")} ${reportText}`;
  return COMPLEX_TIER_HINT.test(hay) ? "complex" : "standard";
}

/** Parse loose US dates for chronological ordering; null if unknown. */
export function parseDerogatoryDateHint(
  detail: string | null | undefined,
): string | null {
  if (!detail) return null;
  const m = detail.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b|\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/,
  );
  if (!m) return null;
  if (m[4]) return `${m[4]}-${m[5]}-${m[6]}`;
  let month = Number(m[1]);
  let day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) {
    const tmp = month;
    month = day;
    day = tmp;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Sort negatives: Round ascending, then oldest→newest derogatory date within
 * Rounds 2–4; undated items last within the round.
 */
export function sortNegativesForDisputePlan(
  items: EngineRankedNeg[],
): EngineRankedNeg[] {
  return [...items].sort((a, b) => {
    if (a.dispute_round !== b.dispute_round)
      return a.dispute_round - b.dispute_round;
    if (a.dispute_round === 1) {
      // inquiries: keep LOWER priority preference then name
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return a.account.localeCompare(b.account);
    }
    const ad = a.derogatory_date || "9999-99-99";
    const bd = b.derogatory_date || "9999-99-99";
    if (ad !== bd) return ad.localeCompare(bd);
    return priorityRank(a.priority) - priorityRank(b.priority);
  });
}

function priorityRank(p: EngineRankedNeg["priority"]): number {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOWER: 3 }[p];
}

/**
 * Project mid-score path from dispute lifts (not a flat % curve).
 * Round 1 ≈ first wave, Round 2 second, Round 3–4 later.
 */
export function projectScoresFromDisputes(opts: {
  today: number | null;
  goalScore: number;
  ranked: EngineRankedNeg[];
}): {
  score_30: number | null;
  score_60: number | null;
  score_90: number | null;
  score_target: number | null;
} {
  const { today, goalScore, ranked } = opts;
  if (today == null) {
    return {
      score_30: null,
      score_60: null,
      score_90: null,
      score_target: goalScore,
    };
  }
  const liftFor = (rounds: DisputeRound[]) =>
    ranked
      .filter((n) => rounds.includes(n.dispute_round))
      .reduce((s, n) => s + n.score_lift, 0);

  // Assume ~55% of Round-1 lift materializes by "30d" checkpoint, etc.
  const r1 = liftFor([1]);
  const r2 = liftFor([2]);
  const r34 = liftFor([3, 4]);

  const afterR1 = clampScore(today + Math.round(r1 * 0.55));
  const afterR2 = clampScore(afterR1 + Math.round(r2 * 0.55) + Math.round(r1 * 0.25));
  const afterR34 = clampScore(
    afterR2 + Math.round(r34 * 0.5) + Math.round(r2 * 0.25),
  );
  const target = clampScore(
    Math.min(goalScore, afterR34 + Math.round((r1 + r2 + r34) * 0.1)),
  );

  // If no negatives, stay near today — do not invent a steep climb
  if (ranked.length === 0) {
    return {
      score_30: today,
      score_60: today,
      score_90: clampScore(today + 5),
      score_target: Math.min(goalScore, clampScore(today + 15)),
    };
  }

  return {
    score_30: afterR1,
    score_60: afterR2,
    score_90: afterR34,
    score_target: target,
  };
}

function clampScore(n: number): number {
  return Math.min(850, Math.max(300, Math.round(n)));
}

export type UtilRow = {
  account: string;
  limit: number;
  balance: number;
  pctUsed: number;
  payTo30: number;
  payTo10: number;
};

/** Spec §6 — open revolving with nonzero limit only; exclude installment/auto/mortgage. */
export function filterRevolvingUtilization(rows: UtilRow[]): UtilRow[] {
  return rows.filter((u) => {
    if (!(u.limit > 0)) return false;
    if (INSTALLMENT_UTIL_EXCLUDE.test(u.account)) return false;
    if (u.pctUsed < 0 || u.pctUsed > 100) return false;
    return true;
  });
}

/**
 * Spec §8 — require tradeline-ish signals so summary/risk-factor lines never become accounts.
 * A valid row should look like a creditor + derogatory marker, not a sentence or stat.
 */
export function looksLikeTradelineNegative(line: string): boolean {
  const t = String(line || "").trim();
  if (t.length < 8 || t.length > 160) return false;
  // Must include a derogatory keyword
  if (
    !/collection|charge.?off|late payment|inquiry|repossession|foreclosure|bankruptcy|lien|judgment|delinquent|past due|derogatory|charged off/i.test(
      t,
    )
  ) {
    return false;
  }
  // Prefer creditor-like prefix (letters) before the keyword
  const hasCreditorPrefix =
    /^[A-Z0-9*\/&.'-]{2,}[A-Za-z0-9*\/\s&.'-]{0,40}\s*[-–—:]?\s*(collection|charge|late|inquiry|repossession|foreclosure|bankruptcy|lien|judgment|delinquent|past due|derogatory)/i.test(
      t,
    ) ||
    /\b(LLC|INC|BANK|FINANCE|CREDIT|FUNDING|CAPITAL|N\.?A\.?)\b/i.test(t);
  // "Late payment on AMEX" / "Inquiry from XYZ"
  const hasTrailingCreditor =
    /^(collection|charge.?off|late payment|hard inquiry|inquiry|delinquent|past due|derogatory)\s+(on|from|at|–|-)\s+[A-Za-z0-9]/i.test(
      t,
    );
  const hasAccountSignal =
    /\$\s*[\d,]+/.test(t) || /\*{2,}\d{2,}/.test(t) || /#\s*\d{3,}/.test(t);
  if (!hasCreditorPrefix && !hasTrailingCreditor && !hasAccountSignal)
    return false;
  return true;
}

/** Detect likely duplicate inquiry pairs (same creditor token, close dates) → Round 1 strength. */
export function flagDuplicateInquiryPairs(
  inquiries: Array<{ creditor: string; date?: string | null }>,
): Set<string> {
  const flagged = new Set<string>();
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24);
  for (let i = 0; i < inquiries.length; i++) {
    for (let j = i + 1; j < inquiries.length; j++) {
      const a = inquiries[i];
      const b = inquiries[j];
      if (norm(a.creditor) !== norm(b.creditor) || !norm(a.creditor)) continue;
      if (!a.date || !b.date) {
        flagged.add(a.creditor);
        flagged.add(b.creditor);
        continue;
      }
      const da = Date.parse(a.date);
      const db = Date.parse(b.date);
      if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
      const days = Math.abs(da - db) / 86_400_000;
      if (days <= 7) {
        flagged.add(a.creditor);
        flagged.add(b.creditor);
      }
    }
  }
  return flagged;
}

export function roundLabel(round: DisputeRound, lang: "en" | "es"): string {
  if (lang === "es") return `Ronda ${round}`;
  return `Round ${round}`;
}

export function programTierLabel(
  tier: ProgramTier,
  lang: "en" | "es",
): string {
  if (tier === "complex") {
    return lang === "es" ? "Reparación Compleja" : "Complex Repair";
  }
  return lang === "es" ? "Reparación Estándar" : "Standard Repair";
}
