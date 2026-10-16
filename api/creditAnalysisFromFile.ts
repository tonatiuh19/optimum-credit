/**
 * OFG Credit Analysis — Phase 2 rules: CreditFile (account-level) → analysis
 * data for the branded Analysis PDF (same pipeline idea as the Progress
 * Report: structured data → deterministic rules → PDF → staff review).
 *
 * Everything here is computed from extracted accounts; nothing is invented.
 * Projections are labelled estimates. Pure (no I/O); inlined into api/index.ts
 * via scripts/inline-credit-file-engine.mjs.
 */
import {
  BUREAUS,
  type Bureau,
  type BureauTradeline,
  type CreditAccount,
  type CreditFile,
  type CreditInquiry,
  type IdentityFlag,
} from "./creditFile";

export type AnalysisRound = 1 | 2 | 3 | 4;
export type NegativeKind =
  | "collection"
  | "charge_off"
  | "late"
  | "repossession"
  | "public_record"
  | "derogatory";

export interface AnalysisNegative {
  creditor: string;
  originalCreditor: string | null;
  kind: NegativeKind;
  bureaus: Bureau[];
  balance: number | null;
  opened: string | null;
  status: string;
  /** Cross-bureau reporting conflicts (Round 3 angles). */
  inconsistencies: string[];
  round: AnalysisRound;
  /** Consumer-dispute remark while Dispute Status says not disputed. */
  hold: boolean;
  holdReason: string | null;
  legalBasis: string;
  /** Rough points if removed (estimate). */
  liftEstimate: number;
}

export interface AnalysisInquiry {
  creditor: string;
  bureau: Bureau;
  date: string;
  /** Two years after the inquiry date. */
  agesOff: string | null;
  action: "dispute" | "ages_off" | "permissible";
  /** Why it is not a target (permissible purpose / active loan pull). */
  excludedReason?: "matches_account" | "active_loan" | null;
  /** Same-day / back-to-back shopping cluster id (Round 1 grouping). */
  clusterId?: number | null;
}

/** Round 1 inquiry cluster (same-day / 2-day shopping burst). */
export interface InquiryCluster {
  id: number;
  from: string;
  to: string;
  count: number;
  perBureau: Record<Bureau, number>;
  /** Over 12 months old: minimal score weight. */
  older12m: boolean;
}

/** Positive account reported inconsistently: Round 3 accuracy UPDATE, never a deletion. */
export interface AccuracyUpdate {
  creditor: string;
  type: string | null;
  bureaus: Bureau[];
  inconsistencies: string[];
}

export interface TradelineRecommendation {
  /** IH-1 / IH-2 codes or a primary line; never cardholder names. */
  code: "IH-1" | "IH-2" | "primary";
  price: number | null;
  impact: string;
  bureaus: Bureau[];
  timing: "now" | "after_closing";
}

/** Active mortgage / loan in progress: disputes and new credit wait. */
export interface EscrowStatus {
  active: boolean;
  source: "agent" | "mortgage_pull" | null;
  /** Loan pulls excluded from Round 1. */
  loanInquiries: Array<{ creditor: string; bureau: Bureau; date: string }>;
}

/** Lender's own score (usually FICO) entered by the agent. */
export interface LenderScore {
  model: string | null;
  score: number | null;
  target: number | null;
}

export interface CreditAnalysisOptions {
  /** Agent flag: true = in escrow, false = not, null/undefined = auto-detect. */
  escrow?: boolean | null;
  lender?: LenderScore | null;
}

export interface BureauOverview {
  reported: boolean;
  score: number | null;
  totalAccounts: number;
  positive: number;
  negative: number;
  hardInquiries: number;
  revolvingLimit: number;
  revolvingBalance: number;
  utilizationPct: number | null;
  totalBalances: number;
  avgAgeMonths: number | null;
  oldest: { creditor: string; opened: string } | null;
}

export interface UtilizationRow {
  account: string;
  limit: number;
  balance: number;
  pctUsed: number;
  payTo30: number;
  payTo10: number;
  authorizedUser: boolean;
  /** Closed card still carrying a balance (counted in "incl. closed" total). */
  closed?: boolean;
  /** Derogatory account: never show payoff targets. */
  derogatory?: boolean;
}

export interface ProjectionMilestone {
  key: "current" | "round1" | "round2" | "round3" | "round4";
  scores: Record<Bureau, number | null>;
}

export interface FileStrengthFactor {
  key: "revolving" | "installment" | "mortgage" | "age" | "derogatory";
  current: number;
  postRepair: number;
}

export interface CreditAnalysisData {
  reportDate: string | null;
  scoreModel: string | null;
  scores: Record<Bureau, number | null>;
  overview: Record<Bureau, BureauOverview>;
  /** Bureaus with no score and no tradelines (freeze / not pulled). */
  missingBureaus: Bureau[];
  negatives: AnalysisNegative[];
  inquiries: AnalysisInquiry[];
  positives: Array<{
    creditor: string;
    type: string | null;
    bureaus: Bureau[];
    opened: string | null;
    limit: number | null;
    balance: number | null;
    status: string | null;
  }>;
  utilization: UtilizationRow[];
  utilizationOverall: { all: number | null; ownCardsOnly: number | null; inclClosed: number | null };
  projections: ProjectionMilestone[];
  fileStrength: { factors: FileStrengthFactor[]; current: number; postRepair: number };
  programTier: ProgramTier;
  totalDerogatoryBalance: number;
  warnings: string[];
  /** Rating printed on the report per bureau (null = not printed). */
  scoreRatings: Record<Bureau, string | null>;
  escrow: EscrowStatus;
  lender: LenderScore | null;
  inquiryClusters: InquiryCluster[];
  /** Round 3 accuracy updates on positive accounts (not deletions). */
  accuracyUpdates: AccuracyUpdate[];
  identityFlags: IdentityFlag[];
  tradelines: TradelineRecommendation[];
}

export type ProgramTier = "standard" | "complex";

/** Same triggers as creditAnalysisEngine.classifyProgramTier (Complex program). */
const COMPLEX_PROGRAM_HINT =
  /\b(bankrupt|repossession|repossessed|\brepo\b|foreclos|tax\s*lien|irs\b|sba\b|student\s*loan|navient|sallie mae|dept\.?\s*of\s*education|medical|hospital|clinic)/i;

/** Same scale as creditAnalysisEngine.estimateDisputeScoreLift (estimate). */
export function negativeLiftEstimate(kind: NegativeKind, hay: string): number {
  if (kind === "public_record" || kind === "repossession") return 45;
  if (kind === "charge_off") return 35;
  if (kind === "collection") return 28;
  if (kind === "late") return /90|120|150/.test(hay) ? 22 : 12;
  return 10;
}

// ── field helpers ───────────────────────────────────────────────────────────

const NEG_TEXT =
  /collection|charge.?off|charged off|repossess|foreclos|bankrupt|delinquen|past due|late\s*\d|late payment|\d{2,3}\s*days?\s*(late|past)|derogatory|written off/i;
const COLLECTION_TEXT =
  /collection|placed for collection|purchased|debt buyer|\b(lvnv|midland|portfolio recovery|jefferson capital|cavalry|resurgent|ic system|enhanced recovery)\b/i;
const DISPUTE_REMARK = /disput/i;
const ACTIVE_DISPUTE = /currently (in )?disput|in dispute|under dispute/i;
const AU_TEXT = /authorized user|\bAU\b/i;

/** "MM/DD/YYYY" | "MM/YYYY" | "M/D/YYYY" → Date (UTC) or null. */
export function parseReportDate(raw: string | null | undefined): Date | null {
  const t = String(raw || "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return new Date(Date.UTC(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return null;
}

function fmtDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

function monthsBetween(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  );
}

function tradelineText(tl: BureauTradeline): string {
  return [tl.paymentStatus, tl.accountStatus, tl.remarks, tl.accountType]
    .filter(Boolean)
    .join(" ");
}

/** Remarks that make an account negative on their own (spec: comments rule). */
const NEG_REMARK = /past due|charged? off|closed by (the )?credit grantor|canceled by credit grantor|collection|repossess/i;

export function isClosedTradeline(tl: BureauTradeline, account: CreditAccount): boolean {
  return (
    !!tl.closedDate ||
    /closed|paid/i.test(tl.accountStatus || "") ||
    /^closed\b/i.test(account.headerStatus || "")
  );
}

/**
 * Negative if ANY is true for this bureau: status/payment text is derogatory;
 * Days Late counts or payment-grid cells show a late (30/60/90/120/150/CO/C/
 * R/F/B); past due > $0; remarks say past due / charged off / closed by credit
 * grantor / collection / repossession; balance over limit on a closed card.
 */
export function isNegativeTradeline(tl: BureauTradeline, account: CreditAccount): boolean {
  if (account.section === "collection") return true;
  if (NEG_TEXT.test(tradelineText(tl))) return true;
  if ((tl.late30 ?? 0) + (tl.late60 ?? 0) + (tl.late90 ?? 0) > 0) return true;
  if ((tl.gridMarks ?? []).length > 0) return true;
  if ((tl.pastDue ?? 0) > 0) return true;
  if (NEG_REMARK.test(tl.remarks || "")) return true;
  return (
    isClosedTradeline(tl, account) &&
    tl.creditLimit !== null &&
    tl.creditLimit > 0 &&
    (tl.balance ?? 0) > tl.creditLimit
  );
}

/** Latest grid late "MM/YYYY:30" → { when, code }. */
function latestGridMark(tls: BureauTradeline[]): { when: string; code: string } | null {
  let best: { when: string; code: string; t: number } | null = null;
  for (const tl of tls) {
    for (const m of tl.gridMarks ?? []) {
      const [when, code] = m.split(":");
      const d = parseReportDate(when);
      if (d && (!best || d.getTime() > best.t)) best = { when, code: code || "", t: d.getTime() };
    }
  }
  return best ? { when: best.when, code: best.code } : null;
}

export function negativeKind(account: CreditAccount, tls: BureauTradeline[]): NegativeKind {
  const hay = `${account.creditor} ${account.headerStatus || ""} ${tls.map(tradelineText).join(" ")}`;
  if (/bankrupt|judgment|lien/i.test(hay)) return "public_record";
  if (/repossess|foreclos/i.test(hay)) return "repossession";
  if (account.section === "collection" || COLLECTION_TEXT.test(hay)) return "collection";
  if (/charge.?off|charged off|written off/i.test(hay)) return "charge_off";
  if (
    /late|delinquen|past due|\d{2,3}\s*days/i.test(hay) ||
    tls.some((t) => (t.late30 ?? 0) + (t.late60 ?? 0) + (t.late90 ?? 0) > 0 || (t.pastDue ?? 0) > 0) ||
    tls.some((t) => (t.gridMarks ?? []).some((m) => /:(30|60|90|120|150)$/.test(m)))
  ) {
    return "late";
  }
  return "derogatory";
}

function distinct<T>(vals: T[]): T[] {
  return [...new Set(vals)];
}

/** Cross-bureau conflicts on the same account (FCRA §611/§623 angles). */
export function findInconsistencies(
  bureaus: Partial<Record<Bureau, BureauTradeline>>,
): string[] {
  const entries = BUREAUS.filter((b) => bureaus[b]).map((b) => [b, bureaus[b]!] as const);
  if (entries.length < 2) return [];
  const out: string[] = [];
  const diff = <K extends keyof BureauTradeline>(
    key: K,
    label: string,
    same: (a: BureauTradeline[K], b: BureauTradeline[K]) => boolean = (a, b) => a === b,
  ) => {
    const vals = entries.filter(([, t]) => t[key] !== null && t[key] !== undefined);
    if (vals.length < 2) return;
    const first = vals[0][1][key];
    if (vals.some(([, t]) => !same(t[key], first))) {
      out.push(`${label}: ${vals.map(([b, t]) => `${b} ${String(t[key])}`).join(" vs ")}`);
    }
  };
  diff("dateOpened", "Date opened", (a, b) => {
    const da = parseReportDate(a as string);
    const db = parseReportDate(b as string);
    return !!da && !!db && Math.abs(monthsBetween(da, db)) < 1;
  });
  diff("balance", "Balance", (a, b) => Math.abs(Number(a) - Number(b)) <= 1);
  diff("dateLastActivity", "Last activity", (a, b) => {
    const da = parseReportDate(a as string);
    const db = parseReportDate(b as string);
    return !!da && !!db && Math.abs(monthsBetween(da, db)) <= 1;
  });
  diff("paymentStatus", "Payment status", (a, b) =>
    String(a).toLowerCase() === String(b).toLowerCase(),
  );
  // Open on one bureau, closed / paid on another.
  const openClosed = entries
    .filter(([, t]) => t.accountStatus)
    .map(([b, t]) => [b, /closed|paid/i.test(t.accountStatus!) ? "Closed" : /open/i.test(t.accountStatus!) ? "Open" : null] as const)
    .filter(([, v]) => v !== null);
  if (openClosed.length >= 2 && distinct(openClosed.map(([, v]) => v)).length > 1) {
    out.push(`Status: ${openClosed.map(([b, v]) => `${b} ${v}`).join(" vs ")}`);
  }
  // Closed date reported by some bureaus only.
  const withClosed = entries.filter(([, t]) => t.closedDate).map(([b]) => b);
  if (withClosed.length > 0 && withClosed.length < entries.length) {
    const without = entries.map(([b]) => b).filter((b) => !withClosed.includes(b));
    out.push(`Closed date: reported by ${withClosed.join("/")}, not by ${without.join("/")}`);
  }
  // Status says late while that bureau's own payment summary shows no lates.
  for (const [b, t] of entries) {
    const statusLate = /late|past due|delinquen/i.test(`${t.paymentStatus || ""} ${t.accountStatus || ""}`);
    const summaryClean =
      t.late30 === 0 && (t.late60 ?? 0) === 0 && (t.late90 ?? 0) === 0 && (t.gridMarks ?? []).length === 0;
    if (statusLate && summaryClean) {
      out.push(`${b}: status "${t.paymentStatus || t.accountStatus}" but payment history shows no lates`);
    }
  }
  const lateKey = (t: BureauTradeline) =>
    `${t.late30 ?? "–"}/${t.late60 ?? "–"}/${t.late90 ?? "–"}`;
  const withLates = entries.filter(([, t]) => t.late30 !== null || t.late60 !== null || t.late90 !== null);
  if (withLates.length >= 2 && distinct(withLates.map(([, t]) => lateKey(t))).length > 1) {
    out.push(`Late counts (30/60/90): ${withLates.map(([b, t]) => `${b} ${lateKey(t)}`).join(" vs ")}`);
  }
  return out;
}

const LEGAL_BASIS: Record<AnalysisRound, string> = {
  1: "FCRA §604, §611",
  2: "FDCPA §809, FCRA §611",
  3: "FCRA §611, §623",
  4: "FCRA §611, §623",
};

function assignRound(kind: NegativeKind, inconsistencies: string[]): AnalysisRound {
  if (kind === "collection") return 2;
  if (inconsistencies.length > 0) return 3;
  return 4;
}

// ── main builder ────────────────────────────────────────────────────────────

/** Tradeline prices (IH codes only — never cardholder names). */
export const TRADELINE_PRICES: Record<"IH-1" | "IH-2", number> = { "IH-1": 800, "IH-2": 800 };

/** Mortgage / loan-underwriting pulls (Credco, CoreLogic, Xactus, Factual Data …). */
const MORTGAGE_PULL =
  /credco|corelogic|core logic|xactus|factual data|informative research|mortgage|home loan|home lending|cbc\b|meridian ?link|kroll factual|advantage plus|equifax mortgage/i;
/** Days back from the report date that a mortgage pull means "active loan". */
export const ESCROW_WINDOW_DAYS = 45;

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Inquiry creditor ~ account creditor (shared 3+ char prefix: "BCI FIN" ~ "BCION"). */
function inquiryMatchesCreditor(inquiry: string, creditor: string): boolean {
  const q = alnum(inquiry);
  const c = alnum(creditor);
  if (q.length < 3 || c.length < 3) return false;
  return q.includes(c) || c.includes(q) || q.slice(0, 3) === c.slice(0, 3);
}

/** Bands from the spec: unknown / missing data always scores 0, never full points. */
function fileStrengthFactors(opts: {
  openRevolving: number;
  ownUtil: number | null;
  openInstallment: number;
  installmentClean: boolean;
  mortgageOpen: boolean;
  avgAgeMonths: number | null;
  negatives: number;
}): Record<FileStrengthFactor["key"], number> {
  const { openRevolving: n, ownUtil } = opts;
  const revolving =
    n === 0
      ? 0
      : n === 1
        ? 8
        : n === 2
          ? 12 + (ownUtil !== null && ownUtil < 10 ? 2 : 0)
          : 16 + (ownUtil !== null && ownUtil < 30 ? 2 : 0) + (ownUtil !== null && ownUtil < 10 ? 2 : 0);
  const installment =
    opts.openInstallment === 0
      ? 0
      : opts.openInstallment === 1
        ? opts.installmentClean ? 12 : 8
        : opts.installmentClean
          ? Math.min(20, 18 + (opts.openInstallment >= 3 ? 2 : 0))
          : 14;
  const mortgage = opts.mortgageOpen ? 18 : 0;
  const m = opts.avgAgeMonths;
  const age =
    m === null
      ? 0
      : m < 24
        ? Math.floor((m / 24) * 6)
        : m < 60
          ? Math.min(14, 8 + 2 * Math.floor((m - 24) / 12))
          : Math.min(20, 16 + 2 * Math.floor((m - 60) / 24));
  const derogatory =
    opts.negatives === 0 ? 18 : opts.negatives === 1 ? 12 : opts.negatives === 2 ? 10 : Math.max(0, 6 - (opts.negatives - 3) * 2);
  return { revolving, installment, mortgage, age, derogatory };
}

export function buildCreditAnalysis(
  file: CreditFile & { scoreModel?: string | null },
  options: CreditAnalysisOptions = {},
): CreditAnalysisData {
  const reportDate = parseReportDate(file.reportDate) ?? new Date();
  const warnings = [...file.warnings];

  const negatives: AnalysisNegative[] = [];
  const positives: CreditAnalysisData["positives"] = [];
  const accuracyUpdates: AccuracyUpdate[] = [];
  const utilization: UtilizationRow[] = [];

  for (const account of file.accounts) {
    const reporting = BUREAUS.filter((b) => account.bureaus[b]);
    const tls = reporting.map((b) => account.bureaus[b]!);
    if (tls.length === 0) continue;
    const negBureaus = reporting.filter((b) => isNegativeTradeline(account.bureaus[b]!, account));
    const pick = <K extends keyof BureauTradeline>(k: K) =>
      tls.map((t) => t[k]).find((v) => v !== null && v !== undefined) ?? null;
    const balance = pick("balance") as number | null;
    const opened = pick("dateOpened") as string | null;
    const original = account.headerStatus?.startsWith("Original creditor: ")
      ? account.headerStatus.slice("Original creditor: ".length)
      : null;
    const inconsistencies = findInconsistencies(account.bureaus);

    if (negBureaus.length > 0) {
      const kind = negativeKind(account, tls);
      const missing = BUREAUS.filter((b) => !reporting.includes(b) && (file.scores[b] !== null || file.accounts.some((a) => a.bureaus[b])));
      if (missing.length) inconsistencies.push(`Not reported to ${missing.join("/")}`);
      const remarkDispute = tls.some(
        (t) => DISPUTE_REMARK.test(t.remarks || "") && !ACTIVE_DISPUTE.test(t.disputeStatus || ""),
      );
      // Round 2 = third-party / resold collections only; an original creditor
      // reporting its own account as a collection goes to Round 3.
      const thirdParty = kind === "collection" && (account.section === "collection" || !!original || COLLECTION_TEXT.test(account.creditor));
      const round: AnalysisRound = thirdParty
        ? 2
        : kind === "collection" || inconsistencies.some((x) => !x.startsWith("Not reported"))
          ? 3
          : 4;
      const grid = latestGridMark(tls);
      const statusText =
        (pick("paymentStatus") as string | null) || (pick("accountStatus") as string | null) || kind;
      const limit = pick("creditLimit") as number | null;
      const detail = [
        grid ? `${statusText} (${grid.when})` : statusText,
        tls.some((t) => (t.pastDue ?? 0) > 0) ? `$${Math.max(...tls.map((t) => t.pastDue ?? 0))} past due` : null,
        limit && balance !== null && balance > limit ? `$${balance} balance on $${limit} limit` : null,
        tls.some((t) => /closed by (the )?credit grantor|canceled by credit grantor/i.test(t.remarks || "")) ? "closed by credit grantor" : null,
      ]
        .filter(Boolean)
        .join(", ");
      negatives.push({
        creditor: account.creditor,
        originalCreditor: original,
        kind,
        bureaus: negBureaus,
        balance,
        opened,
        status: detail,
        inconsistencies,
        round,
        hold: remarkDispute,
        holdReason: remarkDispute ? "Consumer-dispute remark on file — confirm no open dispute, remove the notation, then file" : null,
        legalBasis: LEGAL_BASIS[round],
        liftEstimate: negativeLiftEstimate(kind, tls.map(tradelineText).join(" ")),
      });
    } else {
      positives.push({
        creditor: account.creditor,
        type: pick("accountType") as string | null,
        bureaus: reporting,
        opened,
        limit: pick("creditLimit") as number | null,
        balance,
        status: (pick("accountStatus") as string | null) || (pick("paymentStatus") as string | null),
      });
      // Positive account reported differently across bureaus: accuracy UPDATE only.
      if (inconsistencies.length) {
        accuracyUpdates.push({
          creditor: account.creditor,
          type: pick("accountType") as string | null,
          bureaus: reporting,
          inconsistencies,
        });
      }
    }

    const closed = tls.every((t) => isClosedTradeline(t, account));
    const open = !closed && (tls.some((t) => /open/i.test(t.accountStatus || "")) || /^open\b/i.test(account.headerStatus || "") || !tls.some((t) => t.accountStatus));
    const limit = pick("creditLimit") as number | null;
    const bal = Math.max(0, balance ?? 0);
    if (account.section === "revolving" && limit && limit > 0 && (open || bal > 0)) {
      const derogatory = negBureaus.length > 0;
      utilization.push({
        account: account.creditor,
        limit,
        balance: bal,
        pctUsed: Math.round((bal / limit) * 1000) / 10,
        payTo30: Math.max(0, Math.floor(limit * 0.3)),
        payTo10: Math.max(0, Math.floor(limit * 0.1)),
        authorizedUser: tls.some((t) => AU_TEXT.test(`${t.remarks || ""} ${t.accountType || ""}`)),
        closed: !open || undefined,
        derogatory: derogatory || undefined,
      });
    }
  }

  // Per-bureau overview.
  const overview = {} as Record<Bureau, BureauOverview>;
  for (const b of BUREAUS) {
    const accts = file.accounts.filter((a) => a.bureaus[b]);
    const neg = negatives.filter((n) => n.bureaus.includes(b)).length;
    const revolving = accts.filter((a) => a.section === "revolving");
    const openRev = revolving.filter((a) => !isClosedTradeline(a.bureaus[b]!, a));
    const revLimit = openRev.reduce((s, a) => s + (a.bureaus[b]!.creditLimit ?? 0), 0);
    const revBal = openRev.reduce((s, a) => s + Math.max(0, a.bureaus[b]!.balance ?? 0), 0);
    const opens = accts
      .map((a) => ({ a, d: parseReportDate(a.bureaus[b]!.dateOpened) }))
      .filter((x): x is { a: CreditAccount; d: Date } => !!x.d);
    const ages = opens.map((x) => monthsBetween(x.d, reportDate)).filter((m) => m >= 0);
    const oldest = opens.sort((x, y) => x.d.getTime() - y.d.getTime())[0];
    overview[b] = {
      reported: accts.length > 0 || file.scores[b] !== null,
      score: file.scores[b],
      totalAccounts: accts.length,
      positive: accts.length - neg,
      negative: neg,
      hardInquiries: file.inquiries.filter((q) => q.bureau === b).length,
      revolvingLimit: revLimit,
      revolvingBalance: revBal,
      utilizationPct: revLimit > 0 ? Math.round((revBal / revLimit) * 1000) / 10 : null,
      totalBalances: accts.reduce((s, a) => s + Math.max(0, a.bureaus[b]!.balance ?? 0), 0),
      avgAgeMonths: ages.length ? Math.round(ages.reduce((s, m) => s + m, 0) / ages.length) : null,
      oldest: oldest ? { creditor: oldest.a.creditor, opened: oldest.a.bureaus[b]!.dateOpened! } : null,
    };
  }
  const missingBureaus = BUREAUS.filter((b) => !overview[b].reported);
  if (missingBureaus.length) {
    warnings.push(
      `${missingBureaus.join(", ")} returned no score and no accounts — likely a security freeze or the bureau was not pulled`,
    );
  }

  // Escrow / active loan: agent flag, or a mortgage pull in the last 45 days.
  const recentMortgagePulls = file.inquiries.filter((q) => {
    const d = parseReportDate(q.date);
    return !!d && MORTGAGE_PULL.test(q.creditor) && daysBetween(d, reportDate) <= ESCROW_WINDOW_DAYS && daysBetween(d, reportDate) >= -1;
  });
  const escrowActive = options.escrow === true || (options.escrow !== false && recentMortgagePulls.length > 0);
  const loanPullDates = recentMortgagePulls.map((q) => parseReportDate(q.date)!.getTime());
  const isLoanPull = (q: CreditInquiry): boolean => {
    if (!escrowActive) return false;
    const d = parseReportDate(q.date);
    if (!d || daysBetween(d, reportDate) > ESCROW_WINDOW_DAYS) return false;
    // The mortgage pull itself, or the lender pulling within 3 days of it.
    return MORTGAGE_PULL.test(q.creditor) || loanPullDates.some((t) => Math.abs(t - d.getTime()) <= 3 * 86_400_000);
  };

  // Inquiries: excluded (permissible purpose / active loan), ages off, or Round 1 target.
  const inquiries: AnalysisInquiry[] = file.inquiries.map((q: CreditInquiry) => {
    const d = parseReportDate(q.date);
    const agesOffDate = d ? new Date(Date.UTC(d.getUTCFullYear() + 2, d.getUTCMonth(), d.getUTCDate())) : null;
    const daysLeft = agesOffDate ? (agesOffDate.getTime() - reportDate.getTime()) / 86_400_000 : null;
    const matched =
      q.matchedAccount === true ||
      file.accounts.some((a) => {
        if (!inquiryMatchesCreditor(q.creditor, a.creditor)) return false;
        const opened = BUREAUS.map((b) => parseReportDate(a.bureaus[b]?.dateOpened)).find(Boolean);
        // Opened within ~2 months after the pull → the pull created this account
        // (open dates are often month-only: "12/2024" reads as the 1st).
        return !d || !opened || (daysBetween(d, opened) >= -31 && daysBetween(d, opened) <= 75);
      });
    const loan = isLoanPull(q);
    return {
      creditor: q.creditor,
      bureau: q.bureau,
      date: q.date,
      agesOff: agesOffDate ? fmtDate(agesOffDate) : null,
      action: loan || matched ? "permissible" : daysLeft !== null && daysLeft <= 90 ? "ages_off" : "dispute",
      excludedReason: loan ? "active_loan" : matched ? "matches_account" : null,
      clusterId: null,
    };
  });

  // Round 1 clusters: back-to-back shopping bursts (pulls ≤2 days apart, 3+).
  const targets = inquiries
    .map((q, idx) => ({ q, idx, d: parseReportDate(q.date) }))
    .filter((x): x is { q: AnalysisInquiry; idx: number; d: Date } => !!x.d && x.q.action !== "permissible")
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const inquiryClusters: InquiryCluster[] = [];
  let group: typeof targets = [];
  const flush = () => {
    if (group.length >= 3) {
      const id = inquiryClusters.length + 1;
      const perBureau = { TU: 0, EX: 0, EQ: 0 } as Record<Bureau, number>;
      for (const g of group) {
        perBureau[g.q.bureau] += 1;
        inquiries[g.idx].clusterId = id;
      }
      inquiryClusters.push({
        id,
        from: fmtDate(group[0].d),
        to: fmtDate(group[group.length - 1].d),
        count: group.length,
        perBureau,
        older12m: daysBetween(group[group.length - 1].d, reportDate) > 365,
      });
    }
    group = [];
  };
  for (const t of targets) {
    if (group.length && daysBetween(group[group.length - 1].d, t.d) > 2) flush();
    group.push(t);
  }
  flush();

  // Utilization: open cards (own / all) and a second total incl. closed cards with balances.
  const openRows = utilization.filter((u) => !u.closed);
  const sum = (rows: UtilizationRow[], k: "limit" | "balance") => rows.reduce((s, r) => s + r[k], 0);
  const pct = (rows: UtilizationRow[]) =>
    sum(rows, "limit") > 0 ? Math.round((sum(rows, "balance") / sum(rows, "limit")) * 1000) / 10 : null;
  const utilizationOverall = {
    all: pct(openRows),
    ownCardsOnly: pct(openRows.filter((u) => !u.authorizedUser)),
    inclClosed: utilization.some((u) => u.closed) ? pct(utilization) : null,
  };

  // Tradelines (IH codes only). Thin / high-utilization revolving profile.
  const openRevolving = openRows.length;
  const ownUtil = utilizationOverall.ownCardsOnly ?? utilizationOverall.all;
  const timing: TradelineRecommendation["timing"] = escrowActive ? "after_closing" : "now";
  const tradelines: TradelineRecommendation[] =
    openRevolving < 3 || (ownUtil ?? 0) > 30
      ? [
          { code: "IH-1", price: TRADELINE_PRICES["IH-1"], impact: "+15 to +35 pts (est.)", bureaus: [...BUREAUS], timing },
          { code: "IH-2", price: TRADELINE_PRICES["IH-2"], impact: "+10 to +20 pts (est.)", bureaus: ["EQ", "TU"], timing },
          { code: "primary", price: null, impact: "Builds own revolving depth over 6-12 months", bureaus: [...BUREAUS], timing },
        ]
      : [];

  // Projections per bureau, per round (estimates; only bureaus reporting an item move).
  // When ONE item is what holds some bureaus below one that does not report
  // it, its removal is worth ~30% of that gap (e.g. EX 644 / EQ 666 vs TU 752).
  const gapLift = (n: AnalysisNegative, b: Bureau): number | null => {
    const others = BUREAUS.filter((x) => !n.bureaus.includes(x) && file.scores[x] !== null);
    const mine = file.scores[b];
    if (!others.length || mine === null) return null;
    const otherNegs = negatives.filter((m) => m !== n && m.bureaus.includes(b)).length;
    if (otherNegs > 0) return null;
    const gap = Math.max(...others.map((x) => file.scores[x]!)) - mine;
    return gap >= 40 ? Math.min(45, Math.round(gap * 0.3)) : null;
  };
  const realized = (b: Bureau, rounds: AnalysisRound[]) =>
    Math.round(
      negatives
        .filter((n) => !n.hold && rounds.includes(n.round) && n.bureaus.includes(b))
        .reduce((s, n) => s + (gapLift(n, b) ?? n.liftEstimate * 0.6), 0),
    );
  const r1Lift = (b: Bureau) =>
    Math.min(
      15,
      inquiries
        .filter((q) => q.bureau === b && q.action !== "permissible")
        .reduce((s, q) => {
          const d = parseReportDate(q.date);
          return s + (d && daysBetween(d, reportDate) <= 365 ? 3 : 1);
        }, 0),
    );
  const auLift = tradelines.length ? 15 : 0;
  const project = (extra: (b: Bureau) => number) =>
    Object.fromEntries(
      BUREAUS.map((b) => [b, file.scores[b] === null ? null : Math.min(850, file.scores[b]! + extra(b))]),
    ) as Record<Bureau, number | null>;
  const hasCollections = negatives.some((n) => n.round === 2);
  const projections: ProjectionMilestone[] = [
    { key: "current", scores: project(() => 0) },
    { key: "round1", scores: project((b) => r1Lift(b)) },
    ...(hasCollections ? [{ key: "round2" as const, scores: project((b) => r1Lift(b) + realized(b, [2])) }] : []),
    { key: "round3", scores: project((b) => r1Lift(b) + realized(b, [2, 3])) },
    { key: "round4", scores: project((b) => r1Lift(b) + realized(b, [2, 3, 4]) + auLift) },
  ];

  // File strength: 5 categories × 20, counted data only (unknown = 0).
  const openInstallments = file.accounts.filter(
    (a) => a.section === "installment" && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)),
  );
  const installmentClean = openInstallments.every((a) => !negatives.some((n) => n.creditor === a.creditor));
  const mortgageOpen = file.accounts.some(
    (a) => a.section === "mortgage" && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)),
  );
  const ages = BUREAUS.map((b) => overview[b].avgAgeMonths).filter((m): m is number => m !== null);
  const avgAge = ages.length ? Math.min(...ages) : null;
  const disputable = negatives.filter((n) => !n.hold).length;
  const now = fileStrengthFactors({
    openRevolving,
    ownUtil: ownUtil ?? null,
    openInstallment: openInstallments.length,
    installmentClean,
    mortgageOpen,
    avgAgeMonths: avgAge,
    negatives: negatives.length,
  });
  const post = fileStrengthFactors({
    openRevolving: openRevolving + (tradelines.length ? 1 : 0),
    ownUtil: tradelines.length ? 2 : ownUtil ?? null,
    openInstallment: openInstallments.length,
    installmentClean: true,
    // The escrow loan reports after closing.
    mortgageOpen: mortgageOpen || escrowActive,
    avgAgeMonths: avgAge,
    negatives: negatives.length - disputable,
  });
  const factors: FileStrengthFactor[] = (["revolving", "installment", "mortgage", "age", "derogatory"] as const).map((key) => ({
    key,
    current: now[key],
    postRepair: Math.max(now[key], key === "mortgage" && escrowActive ? 20 : post[key]),
  }));

  // Program tier: Complex only on a COUNTED trigger (never by default / headings).
  const programTier: ProgramTier =
    negatives.some((n) => n.kind === "public_record" || n.kind === "repossession") ||
    file.publicRecordsReported === true ||
    COMPLEX_PROGRAM_HINT.test(negatives.map((n) => `${n.creditor} ${n.originalCreditor || ""} ${n.status}`).join(" "))
      ? "complex"
      : "standard";

  return {
    reportDate: file.reportDate,
    scoreModel: file.scoreModel ?? null,
    scores: file.scores,
    overview,
    missingBureaus,
    negatives: negatives.sort((a, b) => a.round - b.round || (a.opened || "").localeCompare(b.opened || "")),
    inquiries,
    positives,
    utilization: utilization.sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || b.pctUsed - a.pctUsed),
    utilizationOverall,
    projections,
    fileStrength: {
      factors,
      current: factors.reduce((s, f) => s + f.current, 0),
      postRepair: factors.reduce((s, f) => s + f.postRepair, 0),
    },
    programTier,
    totalDerogatoryBalance: negatives.reduce((s, n) => s + Math.max(0, n.balance ?? 0), 0),
    warnings,
    scoreRatings: file.scoreRatings ?? { TU: null, EX: null, EQ: null },
    escrow: {
      active: escrowActive,
      source: options.escrow === true ? "agent" : escrowActive ? "mortgage_pull" : null,
      loanInquiries: file.inquiries.filter(isLoanPull).map((q) => ({ creditor: q.creditor, bureau: q.bureau, date: q.date })),
    },
    lender: options.lender ?? null,
    inquiryClusters,
    accuracyUpdates,
    identityFlags: file.identityFlags ?? [],
    tradelines,
  };
}
