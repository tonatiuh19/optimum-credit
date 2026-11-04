/**
 * Lead credit insights — pure rules (Oct 26 2026). One snapshot per credit
 * report read, saved on the lead so the pipeline can sort by "who to call
 * now": scores vs target, projected middle, negatives by type, utilization,
 * shopping signals, mortgage-file urgency, program value, heat score,
 * readiness, quick wins, next action and stage alerts between two reads.
 *
 * Production entry stays api/index.ts (inlined by scripts/inline-credit-file-engine.mjs).
 */
import type { Bureau, CreditFile } from "./creditFile";
import type { CreditAnalysisData } from "./creditAnalysisFromFile";

/** Bump when the rules below change (stored on every snapshot). */
export const LEAD_INSIGHTS_VERSION = 1;
/** Mortgage cutoffs most lenders use; the first one above the middle is the default target. */
export const LEAD_SCORE_TARGETS = [580, 620, 640, 680, 720] as const;
export const LEAD_DEFAULT_TARGET = 620;

export type LeadReadiness = "ready" | "close" | "long";
export type LeadNextAction =
  | "call_partner_before_underwriting"
  | "call_today_active_loan"
  | "offer_au_after_closing"
  | "start_round1"
  | "pull_full_report"
  | "offer_au"
  | "ready_refer_lender";
export type LeadHeatReason =
  | "active_loan_file"
  | "partner_referred"
  | "shopping_inquiries"
  | "new_account_90d"
  | "close_to_target"
  | "quick_wins"
  | "needs_repair"
  | "already_ready";
export type LeadQuickWin =
  | "duplicate_inquiries"
  | "inquiries_aging_off"
  | "paid_collections"
  | "accuracy_flags"
  | "personal_info";

export interface LeadCreditInsights {
  version: number;
  reportDate: string | null;
  reportFormat: "per_bureau" | "merged";
  scoreModel: string | null;
  scores: Record<Bureau, number | null>;
  middleScore: number | null;
  targetScore: number;
  pointsToTarget: number;
  projectedMiddle: number | null;
  /** First round whose projected middle reaches the target (null = not within Round 4). */
  roundToTarget: 1 | 2 | 3 | 4 | null;
  readiness: LeadReadiness;
  negatives: { total: number; collections: number; chargeOffs: number; lates: number; publicRecords: number; repossessions: number };
  derogBalance: number;
  pastDue: number;
  utilizationPct: number | null;
  lenderUtilizationPct: number | null;
  noOpenCard: boolean;
  inquiries: { last120d: number; last12m: number; sameDayMax: number };
  newAccount90d: { creditor: string; opened: string } | null;
  source: { vendor: string | null; reportId: string | null; company: string | null; requestedBy: string | null; ordered: string | null } | null;
  activeLoanFile: boolean;
  fileStrength: { now: number; projected: number };
  programTier: "standard" | "complex";
  tradelineRecommended: boolean;
  estValueUsd: number;
  heatScore: number;
  heatReasons: LeadHeatReason[];
  quickWins: Array<{ key: LeadQuickWin; count: number }>;
  quickWinsTotal: number;
  nextAction: LeadNextAction;
  /** Group 3: extra reads. */
  scoreFactors: string[];
  oldestAccountMonths: number | null;
  thinFile: boolean;
  studentLoanBalance: number;
  medicalCollections: { count: number; balance: number };
  addressCount: number;
  statesSeen: string[];
  lenderSimulation: string | null;
}

export interface LeadInsightsOptions {
  /** Lender target (agent-entered); else the next mortgage cutoff above the middle. */
  targetScore?: number | null;
  /** Lead already linked to a referral partner. */
  hasReferrer?: boolean;
  /** Program prices in USD (from packages). */
  prices?: { standard: number; complex: number; tradeline: number };
}

const INSIGHT_DAY_MS = 86_400_000;

function parseDate(raw: string | null | undefined): Date | null {
  const t = String(raw ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2])));
  }
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1));
  m = t.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)));
  return null;
}

/** Default target: the lender's, else the first mortgage cutoff above the middle (720 cap). */
export function leadTargetScore(middle: number | null, lenderTarget?: number | null): number {
  if (lenderTarget && lenderTarget >= 300 && lenderTarget <= 850) return lenderTarget;
  if (middle === null) return LEAD_DEFAULT_TARGET;
  return LEAD_SCORE_TARGETS.find((t) => t > middle) ?? LEAD_SCORE_TARGETS[LEAD_SCORE_TARGETS.length - 1];
}

export function leadReadiness(middle: number | null, target: number): LeadReadiness {
  if (middle === null) return "long";
  if (middle >= target) return "ready";
  return target - middle <= 30 ? "close" : "long";
}

/** 0–100: urgency + fit. Each part is explained by a reason code. */
export function leadHeatScore(i: Pick<
  LeadCreditInsights,
  "activeLoanFile" | "source" | "inquiries" | "newAccount90d" | "pointsToTarget" | "readiness" | "quickWinsTotal" | "negatives"
> & { hasReferrer?: boolean }): { score: number; reasons: LeadHeatReason[] } {
  let s = 0;
  const reasons: LeadHeatReason[] = [];
  if (i.activeLoanFile) {
    s += 25;
    reasons.push("active_loan_file");
  }
  if (i.hasReferrer || i.source?.requestedBy) {
    s += 15;
    reasons.push("partner_referred");
  }
  if (i.inquiries.last120d >= 2) {
    s += 15;
    reasons.push("shopping_inquiries");
  } else if (i.inquiries.last120d === 1) s += 8;
  if (i.newAccount90d) {
    s += 5;
    reasons.push("new_account_90d");
  }
  if (i.readiness === "ready") {
    s += 10;
    reasons.push("already_ready");
  } else if (i.pointsToTarget <= 30) {
    s += 20;
    reasons.push("close_to_target");
  } else if (i.pointsToTarget <= 60) s += 12;
  else s += 5;
  if (i.quickWinsTotal >= 3) {
    s += 10;
    reasons.push("quick_wins");
  }
  if (i.negatives.total > 0) {
    s += 10;
    reasons.push("needs_repair");
  }
  return { score: Math.min(100, s), reasons };
}

export function leadNextAction(i: Pick<LeadCreditInsights, "activeLoanFile" | "source" | "noOpenCard" | "readiness" | "negatives" | "reportFormat" | "tradelineRecommended">): LeadNextAction {
  if (i.readiness === "ready" && i.negatives.total === 0) return "ready_refer_lender";
  if (i.activeLoanFile && i.source?.requestedBy) return "call_partner_before_underwriting";
  if (i.activeLoanFile && i.negatives.total > 0) return "call_today_active_loan";
  if (i.activeLoanFile && i.noOpenCard) return "offer_au_after_closing";
  if (i.negatives.total > 0) return "start_round1";
  if (i.reportFormat === "merged") return "pull_full_report";
  return i.tradelineRecommended ? "offer_au" : "start_round1";
}

export function buildLeadCreditInsights(
  a: CreditAnalysisData,
  file: Pick<CreditFile, "accounts" | "identityFlags" | "scoreReasonCodes" | "reportDate"> & { lenderSimulation?: string | null },
  opts: LeadInsightsOptions = {},
): LeadCreditInsights {
  const reportDate = parseDate(a.reportDate ?? file.reportDate) ?? new Date();
  const middle = a.middleScore ?? null;
  const target = leadTargetScore(middle, opts.targetScore ?? a.lender?.target ?? null);
  const pointsToTarget = middle === null ? target - 300 : Math.max(0, target - middle);
  const proj = a.projections.filter((p) => ["round1", "round2", "round3", "round4"].includes(p.key));
  const projectedMiddle = proj.length ? proj[proj.length - 1].middle ?? null : middle;
  const hit = proj.find((p) => (p.middle ?? 0) >= target);
  const roundToTarget = middle !== null && middle >= target ? null : hit ? (Number(hit.key.replace("round", "")) as 1 | 2 | 3 | 4) : null;

  const negs = a.negatives;
  const count = (k: string) => negs.filter((n) => n.kind === k).length;
  const ages = (d: Date | null) => (d ? (reportDate.getTime() - d.getTime()) / INSIGHT_DAY_MS : Infinity);
  const inq = a.inquiries;
  const byDay = new Map<string, number>();
  for (const q of inq) byDay.set(q.date, (byDay.get(q.date) ?? 0) + 1);

  const opened = file.accounts
    .map((acc) => ({ acc, d: parseDate(Object.values(acc.bureaus).find((t) => t?.dateOpened)?.dateOpened ?? null) }))
    .filter((x): x is { acc: (typeof file.accounts)[number]; d: Date } => !!x.d);
  const newest = [...opened].sort((x, y) => y.d.getTime() - x.d.getTime())[0];
  const newAccount90d = newest && ages(newest.d) >= 0 && ages(newest.d) <= 90
    ? { creditor: newest.acc.creditor, opened: `${String(newest.d.getUTCMonth() + 1).padStart(2, "0")}/${newest.d.getUTCFullYear()}` }
    : null;
  const oldest = [...opened].sort((x, y) => x.d.getTime() - y.d.getTime())[0];
  const oldestAccountMonths = oldest ? Math.max(0, Math.floor(ages(oldest.d) / 30.44)) : null;

  const quickWins: Array<{ key: LeadQuickWin; count: number }> = [];
  const dup = inq.filter((q) => q.duplicateOf != null).length;
  if (dup) quickWins.push({ key: "duplicate_inquiries", count: dup });
  const agingOff = inq.filter((q) => q.action === "ages_off").length;
  if (agingOff) quickWins.push({ key: "inquiries_aging_off", count: agingOff });
  const paid = negs.filter((n) => n.paidOn !== undefined && n.paidOn !== null).length;
  if (paid) quickWins.push({ key: "paid_collections", count: paid });
  const flagged = negs.filter((n) => (n.accuracyFlags ?? []).some((f) => !/^missing from|not itemized/i.test(f))).length;
  if (flagged) quickWins.push({ key: "accuracy_flags", count: flagged });
  const idf = (a.identityFlags ?? []).length;
  if (idf) quickWins.push({ key: "personal_info", count: idf });
  const quickWinsTotal = quickWins.reduce((s, q) => s + q.count, 0);

  const prices = opts.prices ?? { standard: 1497, complex: 2497, tradeline: 800 };
  const tradelineRecommended = (a.tradelines ?? []).some((t) => t.code === "IH-1");
  const estValueUsd = (a.programTier === "complex" ? prices.complex : prices.standard) + (tradelineRecommended ? prices.tradeline : 0);

  const studentRe = /student|education|dept\.? of ed|aidvantage|navient|nelnet|sallie mae|mohela|great lakes|fedloan|edfinancial/i;
  const studentLoanBalance = file.accounts
    .filter((acc) => studentRe.test(`${acc.creditor} ${Object.values(acc.bureaus).map((t) => `${t?.accountType ?? ""} ${t?.remarks ?? ""}`).join(" ")}`))
    .reduce((s, acc) => s + Math.max(0, Object.values(acc.bureaus).find((t) => t?.balance != null)?.balance ?? 0), 0);
  const med = negs.filter((n) => n.medical);
  // Address history: every address the read lists (the variance list drops the one all bureaus agree on).
  const addresses = (file.identityFlags ?? a.identityFlags ?? []).filter((f) => f.field === "address");
  const statesSeen = [...new Set(addresses.flatMap((f) => [...f.detail.matchAll(/,\s*([A-Z]{2})\b/g)].map((m) => m[1])))].sort();
  const addressCount = new Set(addresses.flatMap((f) => f.detail.split(";").map((x) => x.trim().toUpperCase()).filter(Boolean))).size;

  const base = {
    version: LEAD_INSIGHTS_VERSION,
    reportDate: a.reportDate ?? file.reportDate ?? null,
    reportFormat: a.reportFormat ?? "per_bureau",
    scoreModel: a.scoreModel ?? null,
    scores: a.scores,
    middleScore: middle,
    targetScore: target,
    pointsToTarget,
    projectedMiddle,
    roundToTarget,
    readiness: leadReadiness(middle, target),
    negatives: {
      total: negs.length,
      collections: count("collection"),
      chargeOffs: count("charge_off"),
      lates: count("late"),
      publicRecords: count("public_record"),
      repossessions: count("repossession"),
    },
    derogBalance: Math.round(a.totalDerogatoryBalance ?? 0),
    pastDue: Math.round(a.totals?.pastDue ?? 0),
    utilizationPct: a.utilizationOverall.all === null ? null : Math.round(a.utilizationOverall.all),
    lenderUtilizationPct: a.utilizationOverall.lenderUtilizationPct ?? null,
    noOpenCard: !!a.utilizationOverall.noOpenCardInGoodStanding,
    inquiries: {
      last120d: inq.filter((q) => ages(parseDate(q.date)) <= 120).length,
      last12m: inq.filter((q) => ages(parseDate(q.date)) <= 365).length,
      sameDayMax: Math.max(0, ...byDay.values()),
    },
    newAccount90d,
    source: a.source ?? null,
    activeLoanFile: !!a.escrow?.active,
    fileStrength: { now: a.fileStrength.current, projected: a.fileStrength.postRepair },
    programTier: a.programTier,
    tradelineRecommended,
    estValueUsd,
    quickWins,
    quickWinsTotal,
    scoreFactors: (file.scoreReasonCodes ?? []).slice(0, 4),
    oldestAccountMonths,
    thinFile: file.accounts.length < 5 || (oldestAccountMonths !== null && oldestAccountMonths < 24),
    studentLoanBalance: Math.round(studentLoanBalance),
    medicalCollections: { count: med.length, balance: Math.round(med.reduce((s, n) => s + Math.max(0, n.balance ?? 0), 0)) },
    addressCount,
    statesSeen,
    lenderSimulation: file.lenderSimulation ?? null,
  };
  const heat = leadHeatScore({ ...base, hasReferrer: opts.hasReferrer });
  return { ...base, heatScore: heat.score, heatReasons: heat.reasons, nextAction: leadNextAction(base) };
}

export type LeadInsightAlert =
  | { key: "score_crossed"; threshold: number; from: number; to: number }
  | { key: "negatives_removed"; from: number; to: number }
  | { key: "new_derogatory"; count: number }
  | { key: "utilization_under_30"; from: number; to: number }
  | { key: "target_reached"; target: number; to: number };

/** Stage alerts between two reads of the same person (older → newer). */
export function leadInsightAlerts(prev: LeadCreditInsights | null, next: LeadCreditInsights): LeadInsightAlert[] {
  if (!prev) return [];
  const out: LeadInsightAlert[] = [];
  const a = prev.middleScore;
  const b = next.middleScore;
  if (a !== null && b !== null && b > a) {
    const crossed = LEAD_SCORE_TARGETS.filter((t) => a < t && b >= t);
    if (crossed.length) out.push({ key: "score_crossed", threshold: crossed[crossed.length - 1], from: a, to: b });
    if (a < next.targetScore && b >= next.targetScore) out.push({ key: "target_reached", target: next.targetScore, to: b });
  }
  if (next.negatives.total < prev.negatives.total) out.push({ key: "negatives_removed", from: prev.negatives.total, to: next.negatives.total });
  const newDerog = next.negatives.collections + next.negatives.chargeOffs - (prev.negatives.collections + prev.negatives.chargeOffs);
  if (newDerog > 0) out.push({ key: "new_derogatory", count: newDerog });
  if (prev.utilizationPct !== null && next.utilizationPct !== null && prev.utilizationPct >= 30 && next.utilizationPct < 30) {
    out.push({ key: "utilization_under_30", from: prev.utilizationPct, to: next.utilizationPct });
  }
  return out;
}

/** Plain-English line for a bell / email (staff-facing; no amounts beyond what the report shows). */
export function leadInsightAlertText(alert: LeadInsightAlert, name: string): string {
  switch (alert.key) {
    case "score_crossed":
      return `${name}: middle score crossed ${alert.threshold} (${alert.from} → ${alert.to}).`;
    case "target_reached":
      return `${name} reached the ${alert.target} target (middle ${alert.to}).`;
    case "negatives_removed":
      return `${name}: negative items down from ${alert.from} to ${alert.to}.`;
    case "new_derogatory":
      return `${name}: ${alert.count} new collection / charge-off on the latest report.`;
    case "utilization_under_30":
      return `${name}: card utilization dropped under 30% (${alert.from}% → ${alert.to}%).`;
  }
}
