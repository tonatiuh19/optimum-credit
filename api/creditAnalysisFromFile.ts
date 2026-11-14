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
  /**
   * Nov 13, 2026 (Cesar): an original-creditor charge-off with bureau conflicts is worked in Round 3 and
   * escalated in Round 4 if Round 3 is verified — listed in both tables, counted once (its round).
   */
  escalationRound?: 4 | null;
  /** Consumer-dispute remark while Dispute Status says not disputed. */
  hold: boolean;
  holdReason: string | null;
  legalBasis: string;
  /** Rough points if removed (estimate). */
  liftEstimate: number;
  /** Last 4 of the account number (never the full number). */
  mask?: string | null;
  /** Spec v2.1 P1-4 accuracy flags (balance > high credit, re-aging, dates not itemized, missing bureau). */
  accuracyFlags?: string[];
  /** Same account under two furnisher names (P1-3): shared group id. */
  duplicateGroup?: number | null;
  /** ECOA joint liability — "(joint)" only. */
  joint?: boolean;
  /** Late counts summed across the account's tradelines (one value for merged rows). */
  lates?: { d30: number; d60: number; d90: number };
  /** First derogatory date if itemized (grid), else last activity (proxy) — table order. */
  derogDate?: string | null;
  /** derogDate is the last-activity proxy (footnote N/I). */
  derogDateIsProxy?: boolean;
  /** Bureaus are not itemized on the source (merged row without Repository). */
  bureausNotItemized?: boolean;
  /** Medical debt (creditor, remarks or type) — a Complex-program trigger. */
  medical?: boolean;
  /** Spec v2.3 P1-3: collection shows Paid (MM/YYYY) — still reported and still negative. */
  paidOn?: string | null;
  /** v2.4 #5: account type from the source (Auto, Revolving, Installment, Mortgage, Collection) — not the issue. */
  accountType?: AccountTypeLabel;
}

export type AccountTypeLabel = "auto" | "revolving" | "installment" | "mortgage" | "collection" | "student_loan" | "open";

/** v2.4 #5: what kind of account it is, from the section and the source's type text. */
export function accountTypeLabel(account: CreditAccount, tls: BureauTradeline[]): AccountTypeLabel {
  const text = `${account.creditor} ${tls.map((t) => `${t.accountType || ""} ${t.creditorType || ""} ${t.remarks || ""}`).join(" ")}`;
  // A debt buyer / agency is a collection whatever section the bureau files it in (LVNV under
  // Experian's "Installment" — Nov 13, 2026).
  if (account.section === "collection" || isCollectorAccount(account, tls)) return "collection";
  if (account.section === "mortgage" || /mortgage|\bmtg\b|home equity|heloc/i.test(text)) return "mortgage";
  if (account.section === "revolving") return "revolving";
  if (/auto(mobile)?\b|vehicle|\blease\b/i.test(text)) return "auto";
  if (STUDENT_LOAN.test(text)) return "student_loan";
  if (account.section === "installment") return "installment";
  return /\bopen\b|utility/i.test(text) ? "open" : "installment";
}

/** Spec v2.1 §5: resolved / active dispute remarks are never new targets. */
export interface InformationalItem {
  creditor: string;
  mask: string | null;
  bureaus: Bureau[];
  note: string;
}

export interface AnalysisInquiry {
  creditor: string;
  /** null = "Not itemized" on the source (never guessed). */
  bureau: Bureau | null;
  date: string;
  /** Two years after the inquiry date. */
  agesOff: string | null;
  action: "dispute" | "ages_off" | "permissible";
  /** Why it is not a target (permissible purpose / active loan pull). */
  excludedReason?: "matches_account" | "active_loan" | null;
  /** Same-day shopping cluster id (Round 1 grouping; 2+ inquiries same date). */
  clusterId?: number | null;
  /** Same creditor + bureau listed again (P1-2): rendered once as "(xN) duplicate"; counts stay raw. */
  duplicateOf?: number | null;
  duplicates?: number;
  /**
   * v2.4 #10: "duplicate" = same creditor + bureau + date; "repeat" = the same creditor again 1-45 days
   * later (a dealer / lender resubmission inside the shopping window).
   */
  duplicateKind?: "duplicate" | "repeat";
  /** Auto creditor (repeat pulls read "auto-shopping window"). */
  autoPull?: boolean;
  /** P1-6: an account opened within 45 days of the pull (affiliate-aware) — still Round 1, lower odds. */
  lowerOdds?: string | null;
  /** Spec v2.3 P1-2: any account opened within 45 days after this pull — still a target, tagged "lower odds". */
  nearAccount?: string | null;
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
  /** now | after_closing (active loan: "after closing or before next application") | hold (primary line blocked). */
  timing: "now" | "after_closing" | "hold";
  /** Optional line (IH-2) / why the line is held. */
  optional?: boolean;
  note?: string | null;
}

/** Active mortgage / loan in progress: disputes and new credit wait. */
export interface EscrowStatus {
  active: boolean;
  source: "agent" | "mortgage_pull" | "mortgage_report" | "lender_report" | "loan_inquiry" | null;
  /** Lender that pulled the report / the active loan (when known). */
  lenderName?: string | null;
  /** Loan pulls excluded from Round 1 (permissible purpose — active transaction). */
  loanInquiries: Array<{ creditor: string; bureau: Bureau | null; date: string }>;
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
  /** Spec v2.3 P0-3/P0-4: why a card is or is not "open in good standing". */
  status?: "open" | "inactive" | "closed" | "charged_off" | "terminated";
  /** Last 4 (several cards can share a creditor name). */
  mask?: string | null;
}

export interface ProjectionMilestone {
  key: "current" | "round1" | "round2" | "round3" | "round4" | "utilization";
  scores: Record<Bureau, number | null>;
  /** Middle of the three (what a lender uses); null with < 3 scores → middle of available. */
  middle?: number | null;
  /** Spec §6 per-bureau estimated range for this step (low–high, cumulative). */
  ranges?: Record<Bureau, [number, number] | null>;
}
/** Spec v2.3 P1-7: projection rows stop at Round 4 ("utilization" is legacy only). */
export const PROJECTION_KEYS_MAX: ProjectionMilestone["key"][] = ["current", "round1", "round2", "round3", "round4"];

/** Spec §11 self-check: parsed data reconciled against the report's own totals. */
export interface SelfCheckItem {
  key:
    | "accounts"
    | "balances"
    | "past_due"
    | "lates"
    | "scores"
    | "name"
    | "positives_in_rounds"
    | "bureau_coverage"
    | "derogs"
    | "utilization"
    | "inquiries"
    | "open_cards"
    | "projection"
    | "file_strength";
  label: string;
  expected: string | null;
  actual: string;
  ok: boolean;
  /**
   * false = shown to staff / the auditor but never blocks on its own. Late
   * totals: providers tally them differently (Factual Data sums counts,
   * Xactus prints a different tally) — a mismatch is ambiguous.
   */
  blocking?: boolean;
}

export interface FileTotals {
  tradelines: number;
  uniqueAccounts: number;
  withBalance: number;
  positive: number;
  negativeTradelines: number;
  negativeAccounts: number;
  collectionsChargeOffs: number;
  totalBalance: number;
  pastDue: number;
  lates: { d30: number; d60: number; d90: number };
  avgAgeMonths: number | null;
  oldest: { creditor: string; opened: string } | null;
  revolvingLimit: number;
  revolvingBalance: number;
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
    /** Last 4 (several accounts can share a creditor name). */
    mask?: string | null;
    /** Spec v2.3 P1-8: Open / Closed MM/YYYY / Paid MM/YYYY / Inactive (…). */
    statusLabel?: string;
    open?: boolean;
    /** "original" = installment / auto: the amount is the original loan, not a limit. */
    amountKind?: "limit" | "original";
    monthlyPayment?: number | null;
  }>;
  utilization: UtilizationRow[];
  utilizationOverall: {
    all: number | null;
    ownCardsOnly: number | null;
    inclClosed: number | null;
    /** Lender Credit Summary figures, shown beside ours (P0-3). */
    lenderUtilizationPct?: number | null;
    lenderUsedPct?: number | null;
    /** No open card in good standing (P0-4) — say so, never "utilization already OK". */
    noOpenCardInGoodStanding?: boolean;
    /** Every card balance sits on a charged-off / collection line (P0-7 wording). */
    allFromDerogatory?: boolean;
  };
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
  /** Spec v2.1 additions (absent on analyses built before it). */
  borrowerName?: string | null;
  reportFormat?: "per_bureau" | "merged";
  vantageScores?: Record<Bureau, number | null>;
  middleScore?: number | null;
  totals?: FileTotals;
  /** Lender tri-merge header (P1-1 / P2-2). */
  source?: { vendor: string | null; reportId: string | null; company: string | null; requestedBy: string | null; ordered: string | null } | null;
  informational?: InformationalItem[];
  selfCheck?: { ok: boolean; items: SelfCheckItem[] };
}

export type ProgramTier = "standard" | "complex";

/** Complex program triggers (counted items only). */
const COMPLEX_PROGRAM_HINT =
  /\b(bankrupt|repossession|repossessed|\brepo\b|foreclos|tax\s*lien|irs\b|student\s*loan|navient|sallie mae|dept\.?\s*of\s*education|medical|hospital|clinic)/i;

/** Estimated score lift per removed item (estimate). */
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
  // MyFreeScoreNow / some bureaus print month names: "Dec 01, 2018", "August 7, 2026", "Dec 2018".
  const named = t.match(/^([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/);
  if (named) {
    const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return new Date(Date.UTC(Number(named[3]), mi, named[2] ? Number(named[2]) : 1));
  }
  // Lender tri-merges (Factual Data, Xactus) print ISO dates: 2019-05-25 / 2019-05.
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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

/** MM/YYYY — complete month + year only (Spec v2.3 P1-6: never a fragment). */
function fmtMonth(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
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
const NEG_REMARK = /past due|charged? off|collection|repossess/i;
/** Grantor closure is negative only while money is still owed (a paid $0 card closed by the bank is not). */
const GRANTOR_CLOSED = /closed by (the )?credit grantor|canceled by credit grantor/i;

/**
 * Charge cards (no preset limit — Metro 2 "Open" account type, e.g. AMEX):
 * the "limit" is a high balance, so they never count toward utilization.
 */
/** v2.4 #3: the only cards that count toward utilization — open, current, not derogatory. */
export function inGoodStanding(u: UtilizationRow): boolean {
  return u.status === "open" && !u.derogatory;
}

export function isChargeCard(tl: BureauTradeline): boolean {
  return /^open(\s+account)?$/i.test((tl.accountType || "").trim()) || /charge card|no preset (spending )?limit/i.test(`${tl.accountType || ""} ${tl.remarks || ""}`);
}

/** Government original creditor (SBA, Treasury, Dept. of …) — not a third-party debt collector. */
const GOVERNMENT_CREDITOR = /\bsba\b|small business admin|\bgovernment\b|u\.?s\.? (dept|department|treasury)|dept\.? of|department of/i;

export function isClosedTradeline(tl: BureauTradeline, account: CreditAccount): boolean {
  return (
    !!tl.closedDate ||
    /closed|paid/i.test(tl.accountStatus || "") ||
    /^closed\b/i.test(account.headerStatus || "")
  );
}

/** Spec v2.3 P0-4: a line is not reported in 6+ months → stale, not active. */
const STALE_MONTHS = 6;

/**
 * Not open / active (Spec v2.3 P0-4): closed, paid, ECOA "T" (terminated) or
 * not reported in the last 6 months. Such a card is never "in good standing"
 * and never the basis of "utilization already OK".
 */
/** v2.4 #10: pulls from one creditor up to 45 days apart are one shopping event (repeat pull). */
const REPEAT_PULL_DAYS = 45;

export function isTerminatedEcoa(account: CreditAccount): boolean {
  return /^t\b/i.test(String(account.ecoa ?? "").trim());
}

export function isInactiveTradeline(tl: BureauTradeline, account: CreditAccount, reportDate: Date): boolean {
  if (isClosedTradeline(tl, account)) return true;
  if (isTerminatedEcoa(account)) return true;
  const reported = parseReportDate(tl.dateReported);
  return !!reported && monthsBetween(reported, reportDate) > STALE_MONTHS;
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
  if (GRANTOR_CLOSED.test(tl.remarks || "") && (tl.balance ?? 0) > 0) return true;
  return (
    isClosedTradeline(tl, account) &&
    tl.creditLimit !== null &&
    tl.creditLimit > 0 &&
    (tl.balance ?? 0) > tl.creditLimit
  );
}


/**
 * Charge-off evidence (Nov 13, 2026 — Cesar, MyFreeScoreNow): the status can read "Collection Account"
 * and the text summary "Charge Off 0" while the account IS charged off — read the remarks
 * ("CHARGED OFF ACCOUNT", "CHARGED TO PROFIT AND LOSS", "REPORTED AS A LOSS") and the grid's "CO" cells.
 */
const CHARGE_OFF_TEXT = /charge.?off|charged off|written off|profit and loss|reported as a loss|\bP\s*&\s*L\b/i;
export function hasChargeOffEvidence(tls: BureauTradeline[]): boolean {
  return tls.some((t) => CHARGE_OFF_TEXT.test(`${t.paymentStatus ?? ""} ${t.accountStatus ?? ""} ${t.remarks ?? ""}`) || (t.gridMarks ?? []).some((m) => /:CO$/i.test(m)));
}

/** The furnisher is a collection agency / debt buyer (not the creditor that issued the account). */
export function isCollectorAccount(account: CreditAccount, tls: BureauTradeline[]): boolean {
  if (account.section === "collection") return true;
  if (/^Original creditor:/i.test(account.headerStatus ?? "")) return true;
  if (tls.some((t) => /ORIGINAL CREDITOR\s*:/i.test(t.remarks ?? "") || /factoring|collection agency|debt buyer/i.test(`${t.accountType ?? ""} ${t.creditorType ?? ""}`))) return true;
  return COLLECTION_TEXT.test(account.creditor);
}

export function negativeKind(account: CreditAccount, tls: BureauTradeline[]): NegativeKind {
  const hay = `${account.creditor} ${account.headerStatus || ""} ${tls.map(tradelineText).join(" ")}`;
  if (/bankrupt|judgment|lien/i.test(hay)) return "public_record";
  if (/repossess|foreclos/i.test(hay)) return "repossession";
  // A collector's account is a collection (FDCPA). The original creditor's charged-off account is a
  // charge-off even when a bureau's status says "Collection Account" (Credit One, OpenSky — Nov 13, 2026).
  if (isCollectorAccount(account, tls)) return "collection";
  if (hasChargeOffEvidence(tls)) return "charge_off";
  if (COLLECTION_TEXT.test(hay)) return "collection";
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
  // Values print in the report's single style (MM/DD/YYYY, $1,234).
  const show = (key: keyof BureauTradeline, v: unknown): string => {
    if (key === "balance" && typeof v === "number") return `$${Math.round(v).toLocaleString("en-US")}`;
    if (key === "dateOpened" || key === "dateLastActivity") {
      const d = parseReportDate(String(v));
      return d ? fmtDate(d) : String(v);
    }
    return String(v);
  };
  const diff = <K extends keyof BureauTradeline>(
    key: K,
    label: string,
    same: (a: BureauTradeline[K], b: BureauTradeline[K]) => boolean = (a, b) => a === b,
  ) => {
    const vals = entries.filter(([, t]) => t[key] !== null && t[key] !== undefined);
    if (vals.length < 2) return;
    const first = vals[0][1][key];
    if (vals.some(([, t]) => !same(t[key], first))) {
      out.push(`${label}: ${vals.map(([b, t]) => `${b} ${show(key, t[key])}`).join(" vs ")}`);
    }
  };
  diff("dateOpened", "Date opened", (a, b) => {
    const da = parseReportDate(a as string);
    const db = parseReportDate(b as string);
    return da && db ? Math.abs(monthsBetween(da, db)) < 1 : String(a).trim() === String(b).trim();
  });
  diff("balance", "Balance", (a, b) => Math.abs(Number(a) - Number(b)) <= 1);
  diff("dateLastActivity", "Last activity", (a, b) => {
    const da = parseReportDate(a as string);
    const db = parseReportDate(b as string);
    return da && db ? Math.abs(monthsBetween(da, db)) <= 1 : String(a).trim() === String(b).trim();
  });
  // "Collection" and "Collection Account" are the same status in two bureaus' wording (Nov 13, 2026).
  const statusKey = (v: unknown) => String(v).toLowerCase().replace(/\baccount\b/g, "").replace(/\s+/g, " ").trim();
  diff("paymentStatus", "Payment status", (a, b) => statusKey(a) === statusKey(b));
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

/** Spec v2.1 §5 legal basis per round. */
const LEGAL_BASIS: Record<AnalysisRound, string> = {
  1: "FCRA §604, §611",
  2: "FDCPA §809, FCRA §611",
  3: "FCRA §611, §623",
  4: "FCRA §611, §623",
};


// ── main builder ────────────────────────────────────────────────────────────

/** Tradeline prices (IH codes only — never cardholder names). */
export const TRADELINE_PRICES: Record<"IH-1" | "IH-2", number> = { "IH-1": 800, "IH-2": 800 };

/** Mortgage / loan-underwriting pulls (Credco, CoreLogic, Xactus, Factual Data …). */
const MORTGAGE_PULL =
  /credco|corelogic|core logic|xactus|factual data|informative research|mortg|home loan|home lending|cbc\b|meridian ?link|kroll factual|advantage (plus|credit)|advntge cred|equifax mortgage|rocket|loan ?depot|united wholesale|\buwm\b|guild mortgage|freedom mortgage|pennymac|newrez|mr\.? ?cooper/i;
/** Auto-loan pulls (Spec §7: a mortgage OR auto inquiry in the last 30 days = active transaction). */
const AUTO_PULL =
  /\bauto\b|motor|carvana|carmax|credit acceptance|westlake|santander consumer|ally fin|bridgecrest|gm financial|toyota|honda fin|ford (motor )?credit|nissan|hyundai|kia motors|exeter|\bcaf\b|capital one auto|chrysler/i;
/** v2.4 #10 label only (never active-loan detection): auto lenders plus dealer brands. */
const AUTO_SHOPPING = new RegExp(
  `${AUTO_PULL.source}|land rover|jaguar|\\bbmw\\b|mercedes|lexus|\\baudi\\b|porsche|volvo|tesla|subaru|mazda|volkswagen|\\bvw\\b|chevrolet|cadillac|\\bgmc\\b|dodge|jeep|acura|infiniti|genesis|dealer`,
  "i",
);
/** Spec §7 active-transaction inquiry window (days before the report). */
export const ACTIVE_TX_INQUIRY_DAYS = 30;
/**
 * Inquiry → account opened within this many days = the pull created that
 * account (permissible purpose) → EXCLUDED from Round 1 (Cesar, Oct 22 2026;
 * supersedes Spec v2.1 P1-6 "keep, lower odds"). Lender/dealer pairs count.
 */
const INQUIRY_ACCOUNT_DAYS = 90;
/** Inquiry creditor → account furnisher affiliates (P1-6). */
const INQUIRY_AFFILIATES: Array<[RegExp, RegExp]> = [
  [/carvana/i, /bridgecrest/i],
  [/drivetime/i, /bridgecrest/i],
  [/700\s*credit|700cr|dealertrack|routeone|cudl|informativ/i, /auto|motor|financ|credit union|\bcu\b|fcu|toyota|honda|nissan|ford|ally|gm financial|santander|westlake|exeter|bridgecrest/i],
  [/upstart/i, /upst|cross river|drbank|digital ?federal/i],
  [/rocket/i, /rocket|quicken/i],
  [/chase/i, /jpmcb|chase/i],
  [/citi/i, /cbna|citi/i],
  [/synchrony|syncb/i, /syncb|synchrony/i],
  [/comenity|bread/i, /comenity|ccb\//i],
  [/td bank|target/i, /td|target/i],
];
/** Furnishers that are the same lender under two names (P1-3 duplicates). */
const RELATED_FURNISHERS: RegExp[] = [/^(ccb|comenity)/i, /^(syncb|synchrony)/i, /^(cbna|citi)/i, /^(td|target\/td)/i, /^(capital one|cap one)/i];
/**
 * Mortgage tri-merge score models (FICO 2/4/5 — "Classic 04", "Classic V5",
 * "Fair Isaac Ver. 2", Beacon 5, Empirica 4): the report itself is a lender pull.
 */
const MORTGAGE_SCORE_MODEL =
  /classic\s*(v\s*)?0?[245]\b|fair isaac (ver\.?|version)\s*0?2\b|fico\s*(score\s*)?(ii|[245])\b|beacon\s*5|empirica\s*4/i;
/** Mortgage-reseller pulls treated as the same loan while in escrow. */
const ESCROW_LOAN_PULL_DAYS = 120;
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
    // Cesar, Oct 27: no open card in good standing = 0/20 (closed-card history earns nothing).
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

/** Active dispute notation → exclude from new rounds (P1-5). */
const ACTIVE_DISPUTE_REMARK =
  /currently (in )?disput|in dispute|under dispute|disputed by consumer|consumer disputes|account (information )?disputed|investigat/i;
/** Resolved / verified dispute notation → informational, needs new evidence (P1-5). */
const RESOLVED_DISPUTE_REMARK =
  /dispute resolved|resolved.{0,20}disagree|consumer disagrees|meets fcra|verified|completed investigation|dispute indicated/i;
const MEDICAL_DEBT = /medical|hospital|clinic|health ?care|physician|radiology|emergency (room|physicians)|ambulance|anesthesi|patholog|laborator|dental|surgery/i;
/** "MEDICAL PAYMENT DATA" etc. is a category tag, not a creditor name. */
const NOT_A_CREDITOR = /payment data|^medical$|^n\/?a$|^unknown$|^none$|^-+$/i;
/**
 * Derogatory date when the late-date lines / payment grid do not itemize the
 * lates: Date Last Delinquent if printed, else the EARLIER of Date Last
 * Activity and Date Opened (Spec v2.3 P1-4). Never a Paid, Closed or Date
 * Reported value — a paid collection's activity moves to the payment date.
 */
export function derogDateProxy(tls: BureauTradeline[], kind: NegativeKind, opened: string | null): string | null {
  // Earliest closed date: anything after it was re-dated (re-aging) and is never used.
  const closedT = tls
    .map((t) => parseReportDate(t.closedDate)?.getTime())
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b)[0];
  const notReDated = (v: string | null | undefined) => {
    const d = parseReportDate(v);
    return !!d && (closedT === undefined || d.getTime() <= closedT);
  };
  const dld = tls.map((t) => t.dateLastDelinquent).find(notReDated);
  if (dld) return dld;
  // Activity after the close is re-dated (re-aging) — never used. Collections close on payment, so their
  // activity before that is kept.
  const cands = [...tls.map((t) => t.dateLastActivity).filter((v) => kind === "collection" || notReDated(v)), opened, ...tls.map((t) => t.dateOpened)]
    .filter((v): v is string => !!v && !!parseReportDate(v))
    .sort((a, b) => parseReportDate(a)!.getTime() - parseReportDate(b)!.getTime());
  return cands[0] ?? null;
}

/** "ChargeOff" / "AsAgreed" → readable status. */
function humanizeStatus(raw: string): string {
  return raw
    .replace(/charge\s*off/gi, "Charge-off")
    .replace(/as\s*agreed/gi, "As agreed")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}
function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
const STUDENT_LOAN = /student|education|dept\.? of ed|aidvantage|navient|nelnet|sallie mae|mohela|great lakes|fedloan|edfinancial/i;

function median3(vals: Array<number | null>): number | null {
  const v = vals.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.floor((v.length - 1) / 2)];
}

function lateTotals(tls: BureauTradeline[], merged: boolean): { d30: number; d60: number; d90: number } {
  // Merged rows carry ONE value copied per bureau — count it once.
  const src = merged ? tls.slice(0, 1) : tls;
  const max = (k: "late30" | "late60" | "late90") => Math.max(0, ...src.map((t) => t[k] ?? 0));
  return { d30: max("late30"), d60: max("late60"), d90: max("late90") };
}

function relatedFurnishers(a: string, b: string): boolean {
  if (alnum(a) === alnum(b)) return true;
  return RELATED_FURNISHERS.some((re) => re.test(a.trim()) && re.test(b.trim()));
}

export function buildCreditAnalysis(
  file: CreditFile & { scoreModel?: string | null },
  options: CreditAnalysisOptions = {},
): CreditAnalysisData {
  const reportDate = parseReportDate(file.reportDate) ?? new Date();
  const warnings = [...file.warnings];
  const merged = file.reportFormat === "merged";

  const negatives: AnalysisNegative[] = [];
  const positives: CreditAnalysisData["positives"] = [];
  const informational: InformationalItem[] = [];
  const utilization: UtilizationRow[] = [];

  // P1-3 duplicates: same open date + same limit + same section + related furnisher = one account, two tradelines.
  const dupGroupOf = new Map<CreditAccount, number>();
  let dupSeq = 0;
  const firstTl = (a: CreditAccount) => BUREAUS.map((b) => a.bureaus[b]).find(Boolean) ?? null;
  for (let i = 0; i < file.accounts.length; i++) {
    for (let j = i + 1; j < file.accounts.length; j++) {
      const a = file.accounts[i];
      const b = file.accounts[j];
      const ta = firstTl(a);
      const tb = firstTl(b);
      if (!ta || !tb || a.section !== b.section || !relatedFurnishers(a.creditor, b.creditor)) continue;
      const da = parseReportDate(ta.dateOpened);
      const db = parseReportDate(tb.dateOpened);
      if (!da || !db || da.getTime() !== db.getTime()) continue;
      if ((ta.creditLimit ?? -1) !== (tb.creditLimit ?? -2)) continue;
      // Different bureaus (or not itemized) — the same card listed under two furnisher names.
      const overlap = BUREAUS.some((x) => a.bureaus[x] && b.bureaus[x]) && !a.merged;
      if (overlap) continue;
      const g = dupGroupOf.get(a) ?? dupGroupOf.get(b) ?? ++dupSeq;
      dupGroupOf.set(a, g);
      dupGroupOf.set(b, g);
    }
  }

  const missingBureausFor = (reporting: Bureau[]) =>
    BUREAUS.filter((b) => !reporting.includes(b) && (file.scores[b] !== null || file.accounts.some((a) => a.bureaus[b])));

  for (const account of file.accounts) {
    const reporting = BUREAUS.filter((b) => account.bureaus[b]);
    const tls = reporting.map((b) => account.bureaus[b]!);
    if (tls.length === 0) continue;
    const isMerged = !!account.merged || merged;
    const negBureaus = reporting.filter((b) => isNegativeTradeline(account.bureaus[b]!, account));
    const pick = <K extends keyof BureauTradeline>(k: K) =>
      tls.map((t) => t[k]).find((v) => v !== null && v !== undefined) ?? null;
    const balance = pick("balance") as number | null;
    const opened = pick("dateOpened") as string | null;
    const originalRaw = account.headerStatus?.startsWith("Original creditor: ")
      ? account.headerStatus.slice("Original creditor: ".length).trim()
      : null;
    const original = originalRaw && !NOT_A_CREDITOR.test(originalRaw) ? originalRaw : null;
    const medical = MEDICAL_DEBT.test(
      `${account.creditor} ${originalRaw ?? ""} ${tls.map((t) => `${t.accountType || ""} ${t.remarks || ""} ${t.creditorType || ""}`).join(" ")}`,
    );
    const remarks = tls.map((t) => `${t.remarks || ""} ${t.disputeStatus || ""}`).join(" ");
    const activeDispute = ACTIVE_DISPUTE_REMARK.test(remarks) && !RESOLVED_DISPUTE_REMARK.test(remarks);
    const resolvedDispute = RESOLVED_DISPUTE_REMARK.test(remarks);
    // P1-2: merged rows hold one blended value per field — never compare them.
    const inconsistencies = isMerged ? [] : findInconsistencies(account.bureaus);
    const dupGroup = dupGroupOf.get(account) ?? null;
    const lates = lateTotals(tls, isMerged);
    const inactive = tls.every((t) => isInactiveTradeline(t, account, reportDate));
    const closedAll = tls.every((t) => isClosedTradeline(t, account));
    const derogKind = negBureaus.length > 0 ? negativeKind(account, tls) : null;

    if (negBureaus.length > 0) {
      const kind = derogKind!;
      const missing = isMerged || account.bureausNotItemized ? [] : missingBureausFor(reporting);
      if (missing.length) inconsistencies.push(`Not reported to ${missing.join("/")}`);
      const government =
        !original && GOVERNMENT_CREDITOR.test(`${account.creditor} ${tls.map((t) => t.remarks || "").join(" ")}`);
      const studentLoan = STUDENT_LOAN.test(`${account.creditor} ${tls.map((t) => `${t.accountType || ""} ${t.remarks || ""}`).join(" ")}`);
      const thirdParty =
        kind === "collection" &&
        !government &&
        (account.section === "collection" || !!original || COLLECTION_TEXT.test(account.creditor));
      const singleOrDup = dupGroup !== null || (!isMerged && !account.bureausNotItemized && reporting.length === 1 && missingBureausFor(reporting).length > 0);
      // Spec v2.1 §5 — classify by item type (Round 4 is NOT an escalation bucket).
      // Round 3 points the source itself shows (Nov 13, 2026 — Cesar):
      // a "B" (bankruptcy) grid code with no bankruptcy in Public Records;
      if (!isMerged && file.publicRecordsReported !== true) {
        for (const b of reporting) {
          const bMonths = (account.bureaus[b]!.gridMarks ?? []).filter((m) => /:B$/i.test(m)).map((m) => m.split(":")[0]);
          if (bMonths.length) inconsistencies.push(`${b} grid shows "B" (bankruptcy) ${bMonths.join(", ")} - no bankruptcy on file`);
        }
      }
      // the same lates a month apart between bureaus (EQ 30-day 01/2025 vs EX 02/2025).
      if (!isMerged) {
        const firstLate = (b: Bureau) =>
          (account.bureaus[b]?.gridMarks ?? [])
            .filter((m) => /:30$/.test(m))
            .map((m) => ({ w: m.split(":")[0], d: parseReportDate(m.split(":")[0]) }))
            .filter((x): x is { w: string; d: Date } => !!x.d)
            .sort((x, y) => x.d.getTime() - y.d.getTime())[0];
        const firsts = reporting.map((b) => ({ b, f: firstLate(b) })).filter((x) => x.f);
        for (let i = 0; i < firsts.length; i++) {
          for (let j = i + 1; j < firsts.length; j++) {
            const [x, y] = [firsts[i], firsts[j]];
            const months = Math.abs((x.f!.d.getUTCFullYear() - y.f!.d.getUTCFullYear()) * 12 + x.f!.d.getUTCMonth() - y.f!.d.getUTCMonth());
            if (months === 1) inconsistencies.push(`lates one month apart (${x.b} 30-day ${x.f!.w} vs ${y.b} ${y.f!.w})`);
          }
        }
      }
      // A bureau that prints "Pays as Agreed" / "Current" on an account it reports as charged off contradicts
      // itself — an accuracy point (Affirm, OpenSky on Experian — Nov 13, 2026).
      if (kind === "charge_off") {
        for (const b of reporting) {
          const t = account.bureaus[b]!;
          const st = `${t.paymentStatus ?? ""}`.trim();
          if (/^(pays as agreed|as agreed|current|paid as agreed|never late)\b/i.test(st) && hasChargeOffEvidence([t])) {
            inconsistencies.push(`${b} status "${st}" on a charged-off account`);
          }
        }
      }
      let round: AnalysisRound;
      let escalationRound: 4 | null = null;
      // Real cross-bureau conflicts (a bureau that simply does not carry the account is not one).
      const conflicts = inconsistencies.filter((x) => !/^Not reported to /.test(x));
      if (kind === "collection") round = thirdParty ? 2 : 3;
      else if (kind === "charge_off") {
        // Original-creditor charge-off: FCRA 611/623 in Round 4; with bureau conflicts, Round 3 first and
        // Round 4 as the escalation (never Round 2 — FDCPA 809 is for collectors only).
        if (conflicts.length) {
          round = 3;
          escalationRound = 4;
        } else round = 4;
      } else if (kind === "repossession" || kind === "public_record") round = 4;
      else if (studentLoan) round = 4;
      else if (kind === "late") round = 3;
      else if (singleOrDup) round = 3;
      else round = 4; // original-creditor derogatory
      if (dupGroup !== null && kind === "late") round = 3;

      // P1-4 accuracy flags.
      const limit = pick("creditLimit") as number | null;
      const installmentLike = account.section !== "revolving";
      const flags: string[] = [];
      if (limit && balance !== null && balance > limit) {
        flags.push(installmentLike ? `balance ${fmtMoney(balance)} exceeds ${fmtMoney(limit)} high credit` : `balance ${fmtMoney(balance)} exceeds ${fmtMoney(limit)} limit`);
      }
      const closedD = parseReportDate(pick("closedDate") as string | null);
      const lastD = parseReportDate(pick("dateLastActivity") as string | null);
      const openedD = parseReportDate(opened);
      // (b) high credit above the limit on a card.
      const highCredit = account.highCredit ?? (pick("highBalance") as number | null);
      // Not when it only repeats (a): a charge-off prints its balance as the high credit.
      if (!installmentLike && highCredit && limit && highCredit > limit && !(balance !== null && balance > limit && highCredit <= balance)) {
        flags.push(`high credit ${fmtMoney(highCredit)} exceeds ${fmtMoney(limit)} limit`);
      }
      // (c) Re-aging: activity or lates reported after the account closed. A collection's "closed"
      // date is its placement / payment, so later activity there is normal — never flagged.
      if (kind !== "collection" && closedD) {
        // Only real lates (30-180) count: a charged-off card keeps printing "CO" every month after it
        // closes, which is the charge-off itself, not re-aging (Nov 13, 2026 — OpenSky).
        const lateAfter = tls
          .flatMap((t) => (t.gridMarks ?? []).filter((m) => /:(30|60|90|120|150|180)$/.test(m)).map((m) => parseReportDate(m.split(":")[0])))
          .filter((d): d is Date => !!d && daysBetween(closedD, d) > 31)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        if (lastD && daysBetween(closedD, lastD) > 60) {
          flags.push(
            `re-aging: closed ${fmtMonth(closedD)}, last activity ${fmtMonth(lastD)}${lateAfter ? `; lates reported after close (through ${fmtMonth(lateAfter)})` : ""}`,
          );
        } else if (lateAfter) {
          flags.push(`re-aging: lates reported after the ${fmtMonth(closedD)} close (through ${fmtMonth(lateAfter)})`);
        }
      }
      // (d) Paid / $0 account still rated late.
      const ratedRaw = `${pick("paymentStatus") ?? ""} ${pick("accountStatus") ?? ""}`;
      if (kind === "late" && closedAll && (balance ?? 0) === 0 && /\d+\s*days?\s*late|delinquen/i.test(ratedRaw)) {
        flags.push(`paid / $0 but still rated "${humanizeStatus(String(pick("paymentStatus") || pick("accountStatus") || ""))}"`);
      }
      // (e) Activity dated before the account was opened — original creditors only (v2.4 #6): a
      // collector's open date is when it bought the debt, so the original DLA normally comes first.
      if (kind !== "collection" && lastD && openedD && lastD.getTime() < openedD.getTime()) {
        flags.push(`last activity ${fmtMonth(lastD)} predates open date ${fmtMonth(openedD)}`);
      }
      const gridAny = tls.some((t) => (t.gridMarks ?? []).length > 0);
      if (lates.d30 + lates.d60 + lates.d90 > 0 && !gridAny) flags.push("late dates not itemized");
      if (missing.length) flags.push(`missing from ${missing.join("/")}`);

      // One derogatory date per account: the FIRST late on the payment grid (Cesar, Oct 22),
      // else last activity as a proxy. Every section shows this same date.
      const firstGrid = tls
        .flatMap((t) => (t.gridMarks ?? []).map((m) => m.split(":")[0]))
        .map((w) => ({ w, d: parseReportDate(w) }))
        .filter((x): x is { w: string; d: Date } => !!x.d)
        .sort((a, b) => a.d.getTime() - b.d.getTime())[0];
      const derogDate = firstGrid?.w ?? derogDateProxy(tls, kind, opened);
      const rawStatus = (pick("paymentStatus") as string | null) || (pick("accountStatus") as string | null) || kind;
      // P0-8: a current "As Agreed" status never describes an account with lates.
      const statusText =
        kind === "late" && /as\s*agreed|current|paid|pays as agreed|never late/i.test(rawStatus)
          ? "Late payments on file"
          : humanizeStatus(rawStatus);
      const lateText =
        lates.d30 + lates.d60 + lates.d90 > 0
          ? [lates.d30 ? `${lates.d30}x30` : null, lates.d60 ? `${lates.d60}x60` : null, lates.d90 ? `${lates.d90}x90` : null]
              .filter(Boolean)
              .join(", ")
          : null;
      const detail = [
        firstGrid ? `${statusText} (first late ${firstGrid.w})` : statusText,
        lateText,
        tls.some((t) => (t.pastDue ?? 0) > 0) ? `${fmtMoney(Math.max(...tls.map((t) => t.pastDue ?? 0)))} past due` : null,
        medical ? "medical" : null,
        tls.some((t) => /closed by (the )?credit grantor|canceled by credit grantor/i.test(t.remarks || "")) ? "closed by credit grantor" : null,
      ]
        .filter(Boolean)
        .join(", ");

      // Spec §5: active dispute → excluded; resolved / verified → informational, needs new evidence.
      if (activeDispute || resolvedDispute) {
        informational.push({
          creditor: account.creditor,
          mask: account.mask,
          bureaus: negBureaus,
          note: activeDispute
            ? "Active dispute on file — excluded from new rounds until it closes"
            : "Prior dispute verified / resolved — informational; needs new evidence before re-disputing",
        });
      }
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
        escalationRound,
        hold: activeDispute || resolvedDispute,
        holdReason: activeDispute
          ? "Active dispute on file — do not re-dispute until it closes"
          : resolvedDispute
            ? "Prior dispute verified / resolved — needs new evidence before re-disputing"
            : null,
        legalBasis: LEGAL_BASIS[round],
        liftEstimate: negativeLiftEstimate(kind, tls.map(tradelineText).join(" ")),
        mask: account.mask,
        accuracyFlags: flags,
        duplicateGroup: dupGroup,
        joint: !!account.joint,
        lates,
        derogDate,
        // N/I only when neither the grid nor Date Last Delinquent dates the lates.
        derogDateIsProxy: !firstGrid && !tls.some((t) => parseReportDate(t.dateLastDelinquent)),
        bureausNotItemized: !!account.bureausNotItemized,
        medical: medical || undefined,
        paidOn: kind === "collection" && closedAll && (balance ?? 0) === 0 ? (closedD ? fmtMonth(closedD) : "") : undefined,
        accountType: accountTypeLabel(account, tls),
      });
    } else {
      const status = (pick("accountStatus") as string | null) || (pick("paymentStatus") as string | null);
      const closedOn = parseReportDate(pick("closedDate") as string | null);
      const reportedOn = parseReportDate(pick("dateReported") as string | null);
      const loanLike = account.section === "installment" || account.section === "mortgage";
      const paid = /paid/i.test(`${status ?? ""} ${tls.map((t) => t.remarks || "").join(" ")}`) || (loanLike && closedAll && (balance ?? 0) === 0);
      // v2.4 #2: a card not reported in 12+ months is flagged stale.
      const stale = !!reportedOn && monthsBetween(reportedOn, reportDate) >= 12;
      const lastRptd = `last rptd ${reportedOn ? fmtMonth(reportedOn) : "not itemized"}`;
      const statusLabel = isTerminatedEcoa(account)
        ? `Terminated (ECOA T) - not counted (${stale ? "stale, " : ""}${lastRptd})`
        : closedAll
          ? `${paid ? "Paid" : "Closed"}${closedOn ? ` ${fmtMonth(closedOn)}` : ""}`
          : inactive
            ? `Inactive (${stale ? "stale, " : ""}${lastRptd})`
            : "Open";
      const typeText = `${pick("accountType") ?? ""}`;
      positives.push({
        creditor: account.creditor,
        type: pick("accountType") as string | null,
        bureaus: reporting,
        opened,
        limit: pick("creditLimit") as number | null,
        balance,
        status,
        mask: account.mask,
        statusLabel,
        open: !inactive,
        amountKind:
          account.section === "installment" || account.section === "mortgage" || /inst|auto|loan|mortgage|lease/i.test(typeText)
            ? "original"
            : "limit",
        monthlyPayment: account.monthlyPayment ?? (pick("paymentAmount") as number | null),
      });
      // P0-7: positives are NEVER dispute targets. A prior dispute remark is informational only.
      if (resolvedDispute || activeDispute) {
        informational.push({
          creditor: account.creditor,
          mask: account.mask,
          bureaus: reporting,
          note: resolvedDispute
            ? "Prior dispute remark (resolved / consumer disagrees) — not re-disputed; may need clearing for underwriting"
            : "Active dispute remark — not a target; may need clearing for underwriting",
        });
      }
    }

    const limit = pick("creditLimit") as number | null;
    const bal = Math.max(0, balance ?? 0);
    const chargeCard = tls.some(isChargeCard);
    // v2.4 #2: ECOA "T" (terminated) is never the consumer's open line — listed, never counted.
    const utilStatus: UtilizationRow["status"] =
      derogKind === "charge_off" || derogKind === "collection"
        ? "charged_off"
        : isTerminatedEcoa(account)
          ? "terminated"
          : closedAll
            ? "closed"
            : inactive
              ? "inactive"
              : "open";
    const open = utilStatus === "open";
    // Lender tri-merges list every revolving line (P0-3); only open cards in good standing count (v2.4 #3).
    if (account.section === "revolving" && !chargeCard && limit && limit > 0 && (isMerged || open || bal > 0)) {
      utilization.push({
        status: utilStatus,
        mask: account.mask,
        account: account.creditor,
        limit,
        balance: bal,
        pctUsed: Math.round((bal / limit) * 1000) / 10,
        payTo30: Math.max(0, Math.floor(limit * 0.3)),
        payTo10: Math.max(0, Math.floor(limit * 0.1)),
        authorizedUser: tls.some((t) => AU_TEXT.test(`${t.remarks || ""} ${t.accountType || ""}`)),
        closed: !open || undefined,
        derogatory: negBureaus.length > 0 || undefined,
      });
    }
  }

  // Double reporting (Nov 13, 2026 — Cesar): the original creditor still reports the balance after the
  // debt was sold — a Round 3 point on the original creditor and a validation point on the collector.
  {
    const key8 = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
    for (const coll of negatives) {
      if (coll.kind !== "collection" || !coll.originalCreditor || !(coll.balance ?? 0)) continue;
      const oc = negatives.find(
        (m) =>
          m !== coll &&
          m.kind !== "collection" &&
          key8(m.creditor).length >= 6 &&
          key8(m.creditor) === key8(coll.originalCreditor!) &&
          (m.balance ?? 0) > 0 &&
          ((!!m.mask && m.mask === coll.mask) || m.balance === coll.balance),
      );
      if (!oc) continue;
      const soldOn = parseReportDate(coll.opened);
      const sold = soldOn ? ` (${fmtMonth(soldOn)})` : "";
      oc.inconsistencies.push(`still reports ${fmtMoney(oc.balance!)} after sale to ${coll.creditor}${sold} - double reporting`);
      coll.inconsistencies.push(`same ${fmtMoney(coll.balance!)} still reported by ${oc.creditor} (double reporting)`);
      if (oc.kind === "charge_off" && oc.round === 4) {
        oc.round = 3;
        oc.escalationRound = 4;
        oc.legalBasis = LEGAL_BASIS[3];
      }
    }
  }

  // File-level totals (merged files: count each row once).
  const accountOpenDate = (a: CreditAccount) =>
    BUREAUS.map((b) => parseReportDate(a.bureaus[b]?.dateOpened)).find(Boolean) ?? null;
  const openedAll = file.accounts
    .map((a) => ({ a, d: accountOpenDate(a) }))
    .filter((x): x is { a: CreditAccount; d: Date } => !!x.d);
  const agesAll = openedAll.map((x) => monthsBetween(x.d, reportDate)).filter((m) => m >= 0);
  const oldestAll = [...openedAll].sort((x, y) => x.d.getTime() - y.d.getTime())[0];
  const acctBalance = (a: CreditAccount) => Math.max(0, firstTl(a)?.balance ?? 0);
  const acctPastDue = (a: CreditAccount) => Math.max(0, ...BUREAUS.map((b) => a.bureaus[b]?.pastDue ?? 0));
  const dupGroupsNeg = new Set(negatives.map((n) => n.duplicateGroup).filter((g): g is number => g !== null && g !== undefined));
  const lateSum = file.accounts.reduce(
    (s, a) => {
      const l = lateTotals(BUREAUS.map((b) => a.bureaus[b]).filter(Boolean) as BureauTradeline[], !!a.merged || merged);
      return { d30: s.d30 + l.d30, d60: s.d60 + l.d60, d90: s.d90 + l.d90 };
    },
    { d30: 0, d60: 0, d90: 0 },
  );
  // v2.4 #3: utilization = open cards in good standing only, on every report format.
  const openRowsAll = utilization.filter(inGoodStanding);
  const totals: FileTotals = {
    tradelines: file.accounts.length,
    uniqueAccounts: file.accounts.length - (dupGroupOf.size - new Set(dupGroupOf.values()).size),
    withBalance: file.accounts.filter((a) => acctBalance(a) > 0).length,
    positive: positives.length,
    negativeTradelines: negatives.length,
    negativeAccounts: negatives.length - (negatives.filter((n) => n.duplicateGroup != null).length - dupGroupsNeg.size),
    collectionsChargeOffs: negatives.filter((n) => n.kind === "collection" || n.kind === "charge_off").length,
    totalBalance: file.accounts.reduce((s, a) => s + acctBalance(a), 0),
    pastDue: file.accounts.reduce((s, a) => s + acctPastDue(a), 0),
    lates: lateSum,
    avgAgeMonths: agesAll.length ? Math.round(agesAll.reduce((s, m) => s + m, 0) / agesAll.length) : null,
    oldest: oldestAll ? { creditor: oldestAll.a.creditor, opened: firstTl(oldestAll.a)?.dateOpened ?? "" } : null,
    revolvingLimit: openRowsAll.reduce((s, r) => s + r.limit, 0),
    revolvingBalance: openRowsAll.reduce((s, r) => s + r.balance, 0),
  };

  // Per-bureau overview.
  const overview = {} as Record<Bureau, BureauOverview>;
  for (const b of BUREAUS) {
    const accts = file.accounts.filter((a) => a.bureaus[b]);
    const neg = negatives.filter((n) => n.bureaus.includes(b)).length;
    const revolving = accts.filter((a) => a.section === "revolving");
    // v2.4 #3: open lines in good standing only (never closed, terminated, stale or derogatory).
    const openRev = revolving.filter(
      (a) =>
        !isChargeCard(a.bureaus[b]!) &&
        !isInactiveTradeline(a.bureaus[b]!, a, reportDate) &&
        !isNegativeTradeline(a.bureaus[b]!, a),
    );
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
      // Unlabeled inquiries are not counted per bureau (P0-6).
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

  // ── Active transaction (Spec §7): agent flag, lender-pulled tri-merge, mortgage report model,
  // or a mortgage/auto inquiry in the last 30 days.
  const lenderName = file.lender?.name ?? null;
  const requestedDate = parseReportDate(file.lender?.requestedDate ?? null);
  const lenderReport = !!(file.lender && (file.lender.name || file.lender.requestedDate)) || (merged && !!lenderName);
  // A loan pull whose account already opened is a finished transaction, not an active one.
  const openedFromPull = (q: CreditInquiry, d: Date) =>
    file.accounts.some((a) => {
      const affiliate = INQUIRY_AFFILIATES.some(([iq, acct]) => iq.test(q.creditor) && acct.test(a.creditor));
      if (!affiliate && !inquiryMatchesCreditor(q.creditor, a.creditor)) return false;
      const op = accountOpenDate(a);
      return !!op && daysBetween(d, op) >= -31 && daysBetween(d, op) <= INQUIRY_ACCOUNT_DAYS;
    });
  const recentLoanPulls = file.inquiries.filter((q) => {
    const d = parseReportDate(q.date);
    if (!d) return false;
    const age = daysBetween(d, reportDate);
    return (
      age >= -1 &&
      age <= ACTIVE_TX_INQUIRY_DAYS &&
      (MORTGAGE_PULL.test(q.creditor) || AUTO_PULL.test(q.creditor)) &&
      !openedFromPull(q, d)
    );
  });
  const recentMortgagePulls = file.inquiries.filter((q) => {
    const d = parseReportDate(q.date);
    return (
      !!d &&
      MORTGAGE_PULL.test(q.creditor) &&
      daysBetween(d, reportDate) <= ESCROW_WINDOW_DAYS &&
      daysBetween(d, reportDate) >= -1 &&
      !openedFromPull(q, d)
    );
  });
  const mortgageReport = MORTGAGE_SCORE_MODEL.test(file.scoreModel || "");
  const autoDetected = lenderReport || mortgageReport || recentMortgagePulls.length > 0 || recentLoanPulls.length > 0;
  const escrowActive = options.escrow === true || (options.escrow !== false && autoDetected);
  const fuzzyLender = (creditor: string): boolean => {
    if (!lenderName) return false;
    const a = alnum(creditor);
    const b = alnum(lenderName);
    if (a.length < 4 || b.length < 4) return false;
    return a.includes(b) || b.includes(a) || a.slice(0, 6) === b.slice(0, 6);
  };
  const loanPullDates = [...recentMortgagePulls, ...recentLoanPulls].map((q) => parseReportDate(q.date)!.getTime());
  const isLoanPull = (q: CreditInquiry): boolean => {
    if (!escrowActive) return false;
    const d = parseReportDate(q.date);
    if (!d) return false;
    // P0-4: the lender that pulled this report (date = Requested date / report date, or fuzzy lender name).
    if (fuzzyLender(q.creditor)) return true;
    if (lenderReport && ((requestedDate && daysBetween(requestedDate, d) === 0) || daysBetween(reportDate, d) === 0)) return true;
    if (MORTGAGE_PULL.test(q.creditor)) return daysBetween(d, reportDate) <= ESCROW_LOAN_PULL_DAYS;
    if (daysBetween(d, reportDate) > ESCROW_WINDOW_DAYS) return false;
    return loanPullDates.some((t) => Math.abs(t - d.getTime()) <= 3 * 86_400_000);
  };

  // ── Inquiries (P0-4, P0-5, P1-6): never infer a bureau; matched accounts stay in Round 1 with lower odds.
  const inquiries: AnalysisInquiry[] = file.inquiries.map((q: CreditInquiry) => {
    const d = parseReportDate(q.date);
    const agesOffDate = d ? new Date(Date.UTC(d.getUTCFullYear() + 2, d.getUTCMonth(), d.getUTCDate())) : null;
    const daysLeft = agesOffDate ? (agesOffDate.getTime() - reportDate.getTime()) / 86_400_000 : null;
    const linked = file.accounts.find((a) => {
      const affiliate = INQUIRY_AFFILIATES.some(([iq, acct]) => iq.test(q.creditor) && acct.test(a.creditor));
      if (!affiliate && !inquiryMatchesCreditor(q.creditor, a.creditor)) return false;
      const op = accountOpenDate(a);
      return !!d && !!op && daysBetween(d, op) >= -31 && daysBetween(d, op) <= INQUIRY_ACCOUNT_DAYS;
    });
    const loan = isLoanPull(q);
    const matched = !loan && (!!linked || q.matchedAccount === true);
    const op = linked ? accountOpenDate(linked) : null;
    return {
      creditor: q.creditor,
      bureau: q.bureau ?? null,
      date: q.date,
      agesOff: agesOffDate ? fmtDate(agesOffDate) : null,
      action: loan || matched ? "permissible" : daysLeft !== null && daysLeft <= 90 ? "ages_off" : "dispute",
      excludedReason: loan ? "active_loan" : matched ? "matches_account" : null,
      clusterId: null,
      // Why it is excluded (shown to staff / client): the account the pull opened.
      lowerOdds: matched
        ? `matches ${linked ? linked.creditor : "an account on file"}${op ? ` opened ${String(op.getUTCMonth() + 1).padStart(2, "0")}/${op.getUTCFullYear()}` : ""}`
        : null,
    };
  });

  // Spec v2.3 P1-2: same creditor + bureau listed again on a tri-merge = ONE dispute row "(x2)"; per-bureau
  // counts stay raw. v2.4 #10: only the same date is a "duplicate"; 1-45 days apart is a "repeat pull".
  // Any account opened within 45 days of a pull tags it "lower odds".
  if (merged) {
    const firstByKey = new Map<string, number>();
    inquiries.forEach((q, i) => {
      if (q.action === "permissible") return;
      const d = parseReportDate(q.date);
      const k = `${alnum(q.creditor)}|${q.bureau ?? "NI"}`;
      const f = firstByKey.get(k);
      const fd = f === undefined ? null : parseReportDate(inquiries[f].date);
      if (f === undefined || !d || !fd || Math.abs(daysBetween(fd, d)) > REPEAT_PULL_DAYS) {
        firstByKey.set(k, i);
        return;
      }
      q.duplicateOf = f;
      const head = inquiries[f];
      head.duplicates = (head.duplicates ?? 1) + 1;
      head.duplicateKind = head.duplicateKind === "repeat" || daysBetween(fd, d) !== 0 ? "repeat" : "duplicate";
      head.autoPull = AUTO_SHOPPING.test(head.creditor);
    });
  }
  for (const q of inquiries) {
    if (q.lowerOdds || q.nearAccount || q.action === "permissible") continue;
    const d = parseReportDate(q.date);
    if (!d) continue;
    const near = file.accounts
      .map((a) => ({ a, op: accountOpenDate(a) }))
      .find((x) => !!x.op && daysBetween(d, x.op) >= 0 && daysBetween(d, x.op) <= 45);
    if (near) q.nearAccount = `lower odds: ${near.a.creditor} opened ${fmtMonth(near.op!)}`;
  }

  // P0-5: a cluster needs 2+ dispute-eligible inquiries on the SAME date.
  const inquiryClusters: InquiryCluster[] = [];
  const byDate = new Map<string, number[]>();
  inquiries.forEach((q, idx) => {
    const d = parseReportDate(q.date);
    // R-2: a pull in a duplicate row ("(x2)") is never counted again in a same-day cluster.
    if (!d || q.action === "permissible" || q.duplicateOf != null || (q.duplicates ?? 1) > 1) return;
    const k = fmtDate(d);
    byDate.set(k, [...(byDate.get(k) ?? []), idx]);
  });
  for (const [k, idxs] of [...byDate.entries()].sort((a, b) => parseReportDate(a[0])!.getTime() - parseReportDate(b[0])!.getTime())) {
    if (idxs.length < 2) continue;
    const id = inquiryClusters.length + 1;
    const perBureau = { TU: 0, EX: 0, EQ: 0 } as Record<Bureau, number>;
    for (const i of idxs) {
      const b = inquiries[i].bureau;
      if (b) perBureau[b] += 1;
      inquiries[i].clusterId = id;
    }
    inquiryClusters.push({
      id,
      from: k,
      to: k,
      count: idxs.length,
      perBureau,
      older12m: daysBetween(parseReportDate(k)!, reportDate) > 365,
    });
  }

  // Utilization.
  const openRows = utilization.filter(inGoodStanding);
  const sum = (rows: UtilizationRow[], k: "limit" | "balance") => rows.reduce((s, r) => s + r[k], 0);
  const pct = (rows: UtilizationRow[]) =>
    sum(rows, "limit") > 0 ? Math.round((sum(rows, "balance") / sum(rows, "limit")) * 1000) / 10 : null;
  const utilBase = openRows;
  const withBalance = utilization.filter((u) => u.balance > 0);
  const utilizationOverall: CreditAnalysisData["utilizationOverall"] = {
    all: pct(utilBase),
    ownCardsOnly: pct(utilBase.filter((u) => !u.authorizedUser)),
    inclClosed: utilization.some((u) => u.closed) ? pct(utilization) : null,
    lenderUtilizationPct: file.summary?.revolvingUtilizationPct ?? null,
    lenderUsedPct: file.summary?.revolvingUsedPct ?? null,
    noOpenCardInGoodStanding: !utilization.some((u) => u.status === "open" && !u.derogatory),
    allFromDerogatory: withBalance.length > 0 && withBalance.every((u) => u.status === "charged_off" || u.derogatory),
  };

  // ── Tradelines (Spec §7). IH codes only.
  const openRevolving = openRows.length;
  const ownUtil = utilizationOverall.ownCardsOnly ?? utilizationOverall.all;
  const revLimitTotal = sum(openRows, "limit");
  const inquiryReasonCode = (file.scoreReasonCodes ?? []).some((c) => /inquir|new account|recently opened/i.test(c));
  const recentAccount = file.accounts.find((a) => {
    const op = accountOpenDate(a);
    return !!op && daysBetween(op, reportDate) >= 0 && daysBetween(op, reportDate) <= 90;
  });
  const auNeeded = (ownUtil ?? 0) > 30 || revLimitTotal < 5000 || openRevolving < 3;
  const auTiming: TradelineRecommendation["timing"] = escrowActive ? "after_closing" : "now";
  const primaryBlockedBy = escrowActive
    ? "Hold until after closing"
    : inquiryReasonCode
      ? "Hold: a score reason code cites inquiries / new accounts"
      : recentAccount
        ? `Hold: ${recentAccount.creditor} opened in the last 90 days`
        : null;
  const tradelines: TradelineRecommendation[] = auNeeded
    ? [
        {
          code: "IH-1",
          price: TRADELINE_PRICES["IH-1"],
          impact: "+15 to +35 pts (est.)",
          // Spec v2.3 P2-4: target bureaus come from the issuer of the line assigned — never a default.
          bureaus: [],
          timing: auTiming,
          note: "Target bureaus per card issuer (Capital One AU = TU / EQ only)",
        },
        {
          code: "IH-2",
          price: TRADELINE_PRICES["IH-2"],
          impact: "+10 to +20 pts (est.)",
          bureaus: ["EQ", "TU"],
          timing: auTiming,
          optional: true,
          note: "Optional. Capital One AU lines do not report to Experian — TU and EQ only.",
        },
        {
          code: "primary",
          price: null,
          impact: "Builds own revolving depth over 6-12 months",
          bureaus: [...BUREAUS],
          timing: primaryBlockedBy ? "hold" : "now",
          note: primaryBlockedBy,
        },
      ]
    : [];

  // ── Projections (Spec §6): per-event ranges, round caps, +100 cumulative, never past 760.
  type Range = [number, number];
  const add = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]];
  const cap = (r: Range, max: number): Range => [Math.min(r[0], max), Math.min(r[1], max)];
  const targetNeg = negatives.filter((n) => !n.hold);
  // Personal-info corrections do not move FICO; only inquiries on that bureau do (v2.3: TU 0 inquiries = unchanged).
  const r1Range = (b: Bureau): Range =>
    inquiries.some((q) => q.action === "dispute" && (q.bureau === b || q.bureau === null)) ? [3, 8] : [0, 0];
  const roundRange = (b: Bureau, round: AnalysisRound): Range => {
    const items = targetNeg.filter((n) => n.round === round && n.bureaus.includes(b));
    let r: Range = [0, 0];
    for (const n of items) {
      // Paid collections still count on FICO 2/4/5 but weigh less than unpaid ones.
      if (n.kind === "collection") r = add(r, n.paidOn !== undefined ? [5, 15] : [10, 20]);
      else if (n.kind === "late") r = add(r, [4, 8]);
      else r = add(r, [20, 35]);
    }
    // Late / charge-off rounds max +30; collections uncapped per round (cumulative cap applies).
    return round === 2 ? r : cap(r, 30);
  };
  const steps: Array<{ key: ProjectionMilestone["key"]; range: (b: Bureau) => Range }> = [
    { key: "round1", range: (b) => r1Range(b) },
    ...(targetNeg.some((n) => n.round === 2) ? [{ key: "round2" as const, range: (b: Bureau) => roundRange(b, 2) }] : []),
    ...(targetNeg.some((n) => n.round === 3) ? [{ key: "round3" as const, range: (b: Bureau) => roundRange(b, 3) }] : []),
    ...(targetNeg.some((n) => n.round === 4) ? [{ key: "round4" as const, range: (b: Bureau) => roundRange(b, 4) }] : []),
    // Spec v2.3 P1-7 / P0-7: rows stop at Round 4. No "utilization under 10%" step — it assumes the
    // client pays balances down (payoff advice); tradeline impact lives only in the tradeline table.
  ];
  const projections: ProjectionMilestone[] = [
    { key: "current", scores: { ...file.scores }, middle: median3(BUREAUS.map((b) => file.scores[b])) },
  ];
  const cum: Record<Bureau, Range> = { TU: [0, 0], EX: [0, 0], EQ: [0, 0] };
  for (const st of steps) {
    const scores = {} as Record<Bureau, number | null>;
    const ranges = {} as Record<Bureau, [number, number] | null>;
    for (const b of BUREAUS) {
      const cur = file.scores[b];
      if (cur === null) {
        scores[b] = null;
        ranges[b] = null;
        continue;
      }
      cum[b] = cap(add(cum[b], st.range(b)), 100);
      const lo = Math.min(760, Math.max(cur, cur + cum[b][0]));
      const hi = Math.min(760, Math.max(cur, cur + cum[b][1]));
      ranges[b] = [lo, hi];
      // Displayed "NNN+": midpoint of the range, never below current.
      scores[b] = Math.max(cur, Math.round((lo + hi) / 2));
    }
    projections.push({ key: st.key, scores, ranges, middle: median3(BUREAUS.map((b) => scores[b])) });
  }

  // File strength: 5 categories × 20, counted data only (unknown = 0).
  // A collector's account is never installment mix, whatever section it is filed under.
  const tlsOf = (a: CreditAccount) => BUREAUS.map((b) => a.bureaus[b]).filter((t): t is BureauTradeline => !!t);
  const openInstallments = file.accounts.filter(
    (a) => a.section === "installment" && !isCollectorAccount(a, tlsOf(a)) && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)),
  );
  const installmentClean = openInstallments.every((a) => !negatives.some((n) => n.creditor === a.creditor));
  const mortgageOpen = file.accounts.some(
    (a) => a.section === "mortgage" && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)),
  );
  const avgAge = totals.avgAgeMonths;
  const disputable = targetNeg.length;
  const now = fileStrengthFactors({
    openRevolving,
    ownUtil: ownUtil ?? null,
    openInstallment: openInstallments.length,
    installmentClean,
    mortgageOpen,
    avgAgeMonths: avgAge,
    negatives: totals.negativeAccounts,
  });
  // Projected post-repair state (v2.3 P2-3): the disputable items removed, utilization under 30%
  // with the AU line, no credit for a loan that has not closed yet.
  const post = fileStrengthFactors({
    openRevolving: openRevolving + (tradelines.length ? 1 : 0),
    ownUtil: tradelines.length ? Math.min(ownUtil ?? 29, 29) : ownUtil ?? null,
    openInstallment: openInstallments.length,
    installmentClean,
    mortgageOpen,
    avgAgeMonths: avgAge,
    negatives: Math.max(0, totals.negativeAccounts - disputable),
  });
  const factors: FileStrengthFactor[] = (["revolving", "installment", "mortgage", "age", "derogatory"] as const).map((key) => ({
    key,
    current: now[key],
    postRepair: Math.max(now[key], post[key]),
  }));

  // Program tier: Complex only on a COUNTED trigger (never by default / headings).
  const programTier: ProgramTier =
    negatives.some((n) => n.kind === "public_record" || n.kind === "repossession" || n.medical) ||
    file.publicRecordsReported === true ||
    COMPLEX_PROGRAM_HINT.test(negatives.map((n) => `${n.creditor} ${n.originalCreditor || ""} ${n.status}`).join(" "))
      ? "complex"
      : "standard";

  // ── Self-check (Spec §11): reconcile against the report's own totals.
  const sc = file.summary ?? null;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const items: SelfCheckItem[] = [];
  if (sc?.totalAccounts != null) {
    // Tri-merge Credit Summary counts typed tradelines only; "Unkn"-type rows are counted separately.
    const unkn = merged ? file.accounts.filter((a) => /^unkn/i.test(String(firstTl(a)?.accountType ?? "").trim())).length : 0;
    items.push({
      key: "accounts",
      label: "Account count",
      expected: String(sc.totalAccounts),
      actual: unkn ? `${totals.tradelines} (${totals.tradelines - unkn} typed + ${unkn} Unkn)` : String(totals.tradelines),
      ok: sc.totalAccounts === totals.tradelines || (unkn > 0 && sc.totalAccounts === totals.tradelines - unkn),
    });
  }
  if (sc?.totalBalance != null) {
    items.push({ key: "balances", label: "Total balances", expected: money(sc.totalBalance), actual: money(totals.totalBalance), ok: Math.abs(sc.totalBalance - totals.totalBalance) <= Math.max(5, sc.totalBalance * 0.005) });
  }
  if (sc?.pastDue != null) {
    items.push({ key: "past_due", label: "Past due", expected: money(sc.pastDue), actual: money(totals.pastDue), ok: Math.abs(sc.pastDue - totals.pastDue) <= Math.max(5, sc.pastDue * 0.005) });
  }
  if (sc && (sc.late30 != null || sc.late60 != null || sc.late90 != null)) {
    const exp = `${sc.late30 ?? "-"} / ${sc.late60 ?? "-"} / ${sc.late90 ?? "-"}`;
    const act = `${totals.lates.d30} / ${totals.lates.d60} / ${totals.lates.d90}`;
    const ok =
      (sc.late30 == null || sc.late30 === totals.lates.d30) &&
      (sc.late60 == null || sc.late60 === totals.lates.d60) &&
      (sc.late90 == null || sc.late90 === totals.lates.d90);
    items.push({ key: "lates", label: "Late counts 30/60/90", expected: exp, actual: act, ok, blocking: false });
  }
  const scoreCount = BUREAUS.filter((b) => file.scores[b] !== null).length;
  items.push({ key: "scores", label: "Scores", expected: null, actual: BUREAUS.map((b) => file.scores[b] ?? "--").join(" / "), ok: scoreCount > 0 });
  const name = String(file.borrowerName ?? "").trim();
  if (file.borrowerName !== undefined) {
    items.push({ key: "name", label: "Borrower name", expected: null, actual: name || "(missing)", ok: !!name && !/\btbd\b|unknown|test/i.test(name) });
  }
  // Spec v2.3 §7: a bureau with a score has at least one tradeline (Laila: EQ 559 with 0 accounts).
  if (file.accounts.length) {
    const uncovered = BUREAUS.filter((b) => file.scores[b] !== null && overview[b].totalAccounts === 0);
    items.push({
      key: "bureau_coverage",
      label: "Bureau coverage",
      expected: "every scored bureau has accounts",
      actual: BUREAUS.map((b) => `${b} ${overview[b].totalAccounts}`).join(" / "),
      ok: uncovered.length === 0,
    });
  }
  if (sc?.collectionsChargeOffs != null) {
    items.push({ key: "derogs", label: "Collections / charge-offs", expected: String(sc.collectionsChargeOffs), actual: String(totals.collectionsChargeOffs), ok: sc.collectionsChargeOffs === totals.collectionsChargeOffs });
  }
  // The lender's figure covers every revolving line it lists; compare like with like.
  const lenderBasisPct = pct(merged ? utilization : utilization.filter((u) => !u.closed));
  if (sc?.revolvingUtilizationPct != null && lenderBasisPct !== null) {
    items.push({
      key: "utilization",
      label: "Revolving utilization",
      expected: `${sc.revolvingUtilizationPct}%`,
      actual: `${Math.round(lenderBasisPct!)}%`,
      ok: Math.abs(sc.revolvingUtilizationPct - lenderBasisPct!) <= 5,
    });
  }
  if (sc?.inquiries != null) {
    // Raw rows before dedupe; vendors differ on whether the requesting lender's own pull is counted.
    items.push({ key: "inquiries", label: "Inquiries", expected: String(sc.inquiries), actual: String(file.inquiries.length), ok: sc.inquiries === file.inquiries.length, blocking: false });
  }
  const badOpen = utilization.filter((u) => u.status === "open" && file.accounts.some((a) => a.creditor === u.account && a.mask === u.mask && BUREAUS.some((b) => a.bureaus[b] && isInactiveTradeline(a.bureaus[b]!, a, reportDate))));
  items.push({ key: "open_cards", label: "Open cards in good standing", expected: null, actual: String(utilization.filter((u) => u.status === "open" && !u.derogatory).length), ok: badOpen.length === 0 });
  const projBad = projections.some(
    (p) => !PROJECTION_KEYS_MAX.includes(p.key) || BUREAUS.some((b) => file.scores[b] !== null && p.scores[b] !== null && (p.scores[b]! > Math.min(760, file.scores[b]! + 100))),
  );
  items.push({ key: "projection", label: "Projection caps (+100, 760, Round 4 max)", expected: null, actual: projBad ? "out of range" : "ok", ok: !projBad });
  const fsCur = factors.reduce((s, f) => s + f.current, 0);
  const fsPost = factors.reduce((s, f) => s + f.postRepair, 0);
  const middleNow = median3(BUREAUS.map((b) => file.scores[b]));
  items.push({
    key: "file_strength",
    label: "File Strength sanity",
    expected: "not over 60 with a middle under 580",
    actual: `${fsCur} -> ${fsPost}`,
    ok: !(middleNow !== null && middleNow < 580 && fsCur > 60),
  });
  // Positives are never added to rounds by construction; checked anyway.
  const positivesInRounds = negatives.filter((n) => positives.some((p) => p.creditor === n.creditor && p.opened === n.opened)).length;
  items.push({ key: "positives_in_rounds", label: "Positive accounts in rounds", expected: "0", actual: String(positivesInRounds), ok: positivesInRounds === 0 });
  if (sc === null && merged) warnings.push("Account Summary totals not read — self-check could not reconcile counts");

  // P2-2: oldest → newest by first derogatory date within each round.
  const dTime = (n: AnalysisNegative) => parseReportDate(n.derogDate ?? n.opened)?.getTime() ?? Number.MAX_SAFE_INTEGER;

  return {
    reportDate: file.reportDate,
    scoreModel: file.scoreModel ?? null,
    scores: file.scores,
    overview,
    missingBureaus,
    negatives: negatives.sort((a, b) => a.round - b.round || dTime(a) - dTime(b)),
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
      source:
        options.escrow === true
          ? "agent"
          : !escrowActive
            ? null
            : lenderReport
              ? "lender_report"
              : recentMortgagePulls.length
                ? "mortgage_pull"
                : mortgageReport
                  ? "mortgage_report"
                  : "loan_inquiry",
      lenderName: lenderName ?? recentLoanPulls[0]?.creditor ?? recentMortgagePulls[0]?.creditor ?? null,
      loanInquiries: file.inquiries.filter(isLoanPull).map((q) => ({ creditor: q.creditor, bureau: q.bureau ?? null, date: q.date })),
    },
    lender: options.lender ?? null,
    inquiryClusters,
    // P0-7: positive accounts are never dispute targets (kept for older readers).
    accuracyUpdates: [],
    identityFlags: normalizeIdentityFlags(file.identityFlags ?? [], file.borrowerName, file.borrowerAddress),
    tradelines,
    borrowerName: file.borrowerName ?? null,
    reportFormat: merged ? "merged" : "per_bureau",
    vantageScores: file.vantageScores ?? { TU: null, EX: null, EQ: null },
    middleScore: median3(BUREAUS.map((b) => file.scores[b])),
    totals,
    informational,
    source: file.lender
      ? {
          vendor: file.lender.vendor ?? null,
          reportId: file.lender.reportId ?? null,
          company: file.lender.name ?? null,
          requestedBy: file.lender.requestedBy ?? null,
          ordered: file.lender.requestedDate ?? null,
        }
      : null,
    selfCheck: { ok: items.every((i) => i.ok || i.blocking === false), items },
  };
}

// ── Review helpers (Claude auditor + reconciliation) ────────────────────────

/** Adds accounts found by the "missing accounts" pass; never duplicates an existing one. */
export function mergeMissingAccounts<F extends CreditFile>(
  file: F,
  extra: CreditAccount[],
  /**
   * Creditors known to be short (first 8 letters → accounts missing). Their look-alikes (same
   * creditor, number, section and open date: Dept of Ed disbursements, Central Research loans) are
   * added up to that many, unless they repeat an account's bureaus and balances exactly.
   */
  shortByCreditor?: Map<string, number>,
): { file: F; added: number } {
  const key = (a: CreditAccount) =>
    `${alnum(a.creditor)}|${(a.mask ?? "").slice(-4)}|${a.section}|${BUREAUS.map((b) => a.bureaus[b]?.dateOpened ?? "").find(Boolean) ?? ""}`;
  const exact = (a: CreditAccount) => `${key(a)}|${BUREAUS.map((b) => (a.bureaus[b] ? `${b}:${a.bureaus[b]!.balance ?? ""}` : "")).join(",")}`;
  const have = new Set(file.accounts.map(key));
  const haveExact = new Set(file.accounts.map(exact));
  const left = new Map(shortByCreditor ?? []);
  const add = extra.filter((a) => {
    if (!a.creditor || !BUREAUS.some((b) => a.bureaus[b])) return false;
    if (!have.has(key(a))) return true;
    const c = alnum(a.creditor).slice(0, 8);
    const n = left.get(c) ?? 0;
    if (n <= 0 || haveExact.has(exact(a))) return false;
    left.set(c, n - 1);
    haveExact.add(exact(a));
    return true;
  });
  return { file: { ...file, accounts: [...file.accounts, ...add] }, added: add.length };
}

/** Compact, human-readable analysis for the auditor (no SSN / DOB / full numbers). */
export function analysisSummaryForAudit(a: CreditAnalysisData): string {
  const bl = (bs: Bureau[], ni?: boolean) => (ni ? "Not itemized" : bs.join(","));
  const lines: string[] = [];
  lines.push(`Name: ${a.borrowerName ?? "(none)"}`);
  lines.push(`Scores: TU ${a.scores.TU ?? "--"} / EX ${a.scores.EX ?? "--"} / EQ ${a.scores.EQ ?? "--"}; middle ${a.middleScore ?? "--"}`);
  lines.push(`Active transaction: ${a.escrow.active ? `YES (${a.escrow.source}; ${a.escrow.lenderName ?? "lender unknown"})` : "no"}`);
  if (a.totals) {
    lines.push(
      `Totals: ${a.totals.tradelines} tradelines, ${a.totals.withBalance} with balances, ${a.totals.positive} positive, ${a.totals.negativeTradelines} negative; balances $${a.totals.totalBalance}; past due $${a.totals.pastDue}; lates ${a.totals.lates.d30}/${a.totals.lates.d60}/${a.totals.lates.d90}`,
    );
  }
  lines.push("Inquiries:");
  const why = (q: AnalysisInquiry) =>
    q.excludedReason === "active_loan"
      ? "EXCLUDED - permissible purpose: active transaction (the lender pulling this report / the active loan)"
      : q.excludedReason === "matches_account"
        ? `EXCLUDED - permissible purpose: ${q.lowerOdds ?? "matches an account opened from this inquiry"}`
        : q.action === "permissible"
          ? "EXCLUDED - permissible purpose"
          : q.action === "ages_off"
            ? "ages off soon (no dispute)"
            : "Round 1 dispute target";
  for (const q of a.inquiries) lines.push(`- ${q.date} ${q.creditor} [${q.bureau ?? "Not itemized"}] → ${why(q)}`);
  lines.push(`Personal-info variances (Round 1): ${(a.identityFlags ?? []).map((f) => `${f.field} on ${f.bureau ?? "Not itemized"}`).join("; ") || "none"}`);
  for (const r of [2, 3, 4] as const) {
    lines.push(`Round ${r}:`);
    for (const n of a.negatives.filter((x) => x.round === r && !x.hold)) {
      lines.push(
        `- ${n.creditor}${n.mask ? ` ...${n.mask}` : ""}${n.opened ? ` opened ${n.opened}` : ""} | ${n.kind} | ${bl(n.bureaus, n.bureausNotItemized)} | ${n.status}${n.balance ? ` | $${n.balance}` : ""}`,
      );
    }
  }
  lines.push(`Informational: ${(a.informational ?? []).map((i) => i.creditor).join(", ") || "none"}`);
  lines.push(
    `Positive accounts (never targets): ${
      a.positives.map((p) => `${p.creditor}${p.mask ? ` ...${p.mask}` : ""}${p.opened ? ` opened ${p.opened}` : ""} (${p.status ?? "?"})`).join(", ") || "none"
    }`,
  );
  lines.push(`Program: ${a.programTier}`);
  return lines.join("\n");
}


/** "•••TH ST, DOWNEY, CA •••" / "123 Main St., Downey CA" → comparable key. */
function identityKey(v: string): string {
  return v
    .toUpperCase()
    .replace(/•+/g, " ")
    .replace(/\b(STREET)\b/g, "ST")
    .replace(/\b(AVENUE)\b/g, "AVE")
    .replace(/\b(BOULEVARD)\b/g, "BLVD")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "AKA: LAILA R ELHASSANI" → ["LAILA", "R", "ELHASSANI"] (hyphens and periods are spacing, not differences). */
function nameTokens(v: string): string[] {
  return identityKey(v.replace(/^\s*(AKA|NM|NAME)\s*:\s*/i, "")).split(" ").filter(Boolean);
}

/**
 * v2.4 #7: is this name a real error against the legal (Borrower block) name? Normal formats are NOT:
 * spacing / hyphen ("EL HASSANI", "REAVES-ELHASSANI"), joined tokens ("REAVESELHASSANI"), initials,
 * order ("ELHASSANI LAILA REAVES") and a short field-width cut at the end ("LAILA REAVES EL").
 * Errors: a repeated token ("LAILA LAILA"), a misspelled token ("ELHASSAN"), or a name that does not match.
 */
export function nameVariantIsError(variant: string, legalName: string): boolean {
  const legal = nameTokens(legalName);
  const t = nameTokens(variant);
  if (!t.length || !legal.length) return false;
  const known = new Set(legal);
  // Adjacent legal tokens written as one word.
  for (let i = 0; i < legal.length; i++) for (let j = i + 2; j <= legal.length; j++) known.add(legal.slice(i, j).join(""));
  if (t.some((tok, i) => tok.length > 1 && t.indexOf(tok) !== i)) return true;
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    if (known.has(tok) || (tok.length === 1 && legal.some((l) => l[0] === tok))) {
      i++;
      continue;
    }
    // One legal token written as two or more words ("EL HASSANI").
    let joined = tok;
    let j = i + 1;
    for (; j < t.length && !known.has(joined); j++) joined += t[j];
    if (known.has(joined)) {
      i = j;
      continue;
    }
    if (i === t.length - 1 && tok.length <= 3 && legal.some((l) => l.startsWith(tok))) {
      i++;
      continue;
    }
    return true;
  }
  return false;
}

const ADDRESS_SUFFIX: Record<string, string> = {
  AV: "AVE", AVE: "AVE", AVENUE: "AVE", ST: "ST", STREET: "ST", DR: "DR", DRIVE: "DR", RD: "RD", ROAD: "RD",
  BLVD: "BLVD", BOULEVARD: "BLVD", LN: "LN", LANE: "LN", CT: "CT", COURT: "CT", WAY: "WAY", PL: "PL", PLACE: "PL",
  CIR: "CIR", CIRCLE: "CIR", PKWY: "PKWY", PARKWAY: "PKWY", HWY: "HWY", HIGHWAY: "HWY", TER: "TER", TRL: "TRL",
};
const UNIT_WORD = /^(APT|APARTMENT|UNIT|STE|SUITE|NO|#)$/;

/** "950 S FAIRFAX AV 506, LOS ANGELES, CA ••• - REPORTED 01/24/2023" → street key, unit, last reported date. */
export function parseIdentityAddress(raw: string): { street: string; display: string; unit: string | null; lastReported: Date | null } | null {
  const [addrPart, ...rest] = raw.split(/\s+-\s+REPORTED\b/i);
  const dates = (rest.join(" ").match(/\b\d{1,2}\/(?:\d{1,2}\/)?\d{4}\b/g) ?? [])
    .map((d) => parseReportDate(d))
    .filter((d): d is Date => !!d);
  const [line, city] = addrPart.replace(/#/g, " # ").split(",").map((x) => x.trim());
  const toks = identityKey(line).split(" ").filter(Boolean);
  if (!toks.length || !/^\d/.test(toks[0])) return null;
  let unit: string | null = null;
  const kept: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (UNIT_WORD.test(toks[i]) && toks[i + 1]) {
      unit = toks[++i];
      continue;
    }
    // A trailing number after the street suffix is the unit ("FAIRFAX AV 506").
    if (i === toks.length - 1 && i > 1 && /\d/.test(toks[i]) && ADDRESS_SUFFIX[toks[i - 1]]) {
      unit = toks[i];
      continue;
    }
    kept.push(ADDRESS_SUFFIX[toks[i]] && i > 1 ? ADDRESS_SUFFIX[toks[i]] : toks[i]);
  }
  const lastReported = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  return { street: `${kept.join(" ")}|${identityKey(city ?? "")}`, display: kept.join(" "), unit, lastReported };
}

/**
 * Personal-info variances, normalized (Cesar, Oct 22 + v2.4 #4/#7): each flag's detail is split into
 * its values, values are de-duplicated, and a value every flagged bureau reports the same way is NOT
 * a variance. Names: only real errors against the legal name. Addresses: the Borrower-block / most
 * recently reported address is never a target, but a unit that differs between bureaus on the same
 * street is (one unit_mismatch flag per bureau); other prior addresses are "confirm with client".
 */
export function normalizeIdentityFlags(
  flags: IdentityFlag[],
  borrowerName?: string | null,
  borrowerAddress?: string | null,
): IdentityFlag[] {
  const out: IdentityFlag[] = [];
  const legal = borrowerName ? identityKey(borrowerName) : null;
  for (const field of ["name", "address", "ssn", "dob"] as const) {
    const rows = flags.filter((f) => f.field === field);
    if (!rows.length) continue;
    if (field === "ssn" || field === "dob") {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = `${r.bureau}|${identityKey(r.detail)}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(r);
        }
      }
      continue;
    }
    const bureausWithField = new Set(rows.map((r) => r.bureau ?? "NI"));
    const values = new Map<string, { text: string; bureaus: Set<string> }>();
    for (const r of rows) {
      for (const raw of r.detail.split(/;|\n/).map((x) => x.trim()).filter(Boolean)) {
        const text = raw.replace(/^\s*(AKA|NM|NAME)\s*:\s*/i, "").replace(/\s+/g, " ");
        const k = identityKey(text);
        if (k.length < 3) continue;
        const v = values.get(k) ?? { text, bureaus: new Set<string>() };
        v.bureaus.add(r.bureau ?? "NI");
        values.set(k, v);
      }
    }
    if (field === "address") {
      out.push(...addressVariances([...values.values()], bureausWithField, borrowerAddress ?? null));
      continue;
    }
    for (const v of values.values()) {
      // The verified legal name (Borrower block) is never a variance; with it, only real errors are.
      if (legal && (identityKey(v.text) === legal || !nameVariantIsError(v.text, borrowerName!))) continue;
      // Without a legal name: same value on every bureau that has this field → consistent.
      if (!legal && bureausWithField.size > 1 && v.bureaus.size === bureausWithField.size) continue;
      for (const b of v.bureaus) out.push({ bureau: b === "NI" ? null : (b as Bureau), field, detail: v.text });
    }
  }
  return out;
}

function addressVariances(
  values: Array<{ text: string; bureaus: Set<string> }>,
  bureausWithField: Set<string>,
  borrowerAddress: string | null,
): IdentityFlag[] {
  const out: IdentityFlag[] = [];
  const parsed = values.map((v) => ({ v, a: parseIdentityAddress(v.text) }));
  const current =
    (borrowerAddress ? parseIdentityAddress(borrowerAddress)?.street : null) ??
    parsed
      .filter((p) => p.a?.lastReported)
      .sort((x, y) => y.a!.lastReported!.getTime() - x.a!.lastReported!.getTime())[0]?.a?.street ??
    null;
  const byStreet = new Map<string, typeof parsed>();
  for (const p of parsed) {
    const k = p.a?.street ?? `raw|${identityKey(p.v.text)}`;
    byStreet.set(k, [...(byStreet.get(k) ?? []), p]);
  }
  const asBureau = (b: string) => (b === "NI" ? null : (b as Bureau));
  for (const [street, group] of byStreet) {
    const unitBy = new Map<string, string | null>();
    for (const p of group) for (const b of p.v.bureaus) if (b !== "NI") unitBy.set(b, p.a?.unit ?? null);
    const units = new Set(unitBy.values());
    const bureausHere = new Set(group.flatMap((p) => [...p.v.bureaus]));
    if (group[0].a && units.size > 1) {
      const detail = `${group[0].a.display}: ${[...unitBy.entries()].map(([b, u]) => (u ? `#${u} (${b})` : `no unit (${b})`)).join(" vs ")}`;
      for (const b of unitBy.keys()) out.push({ bureau: asBureau(b), field: "address", detail, kind: "unit_mismatch" });
    }
    if (street === current) continue;
    // Same address and unit on every bureau that lists addresses → consistent history, not a variance.
    if (bureausWithField.size > 1 && bureausHere.size === bureausWithField.size && units.size <= 1) continue;
    for (const p of group) for (const b of p.v.bureaus) out.push({ bureau: asBureau(b), field: "address", detail: p.v.text, kind: "confirm" });
  }
  return out;
}
