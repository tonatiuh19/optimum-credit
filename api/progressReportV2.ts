/**
 * OFG Progress Report v2 (Cesar spec, Oct 15 2026) — diff engine, formulas,
 * validation layer and the 3-page PDF.
 *
 *  - Account matching BEFORE↔AFTER: account number + open month (fallback:
 *    creditor fuzzy + open month + limit). Never creditor name alone.
 *  - Honest attribution: only deletions / corrected history are wins.
 *    Client payments, re-reports, aged-off inquiries are labeled separately.
 *  - Validation never stops generation; it raises review flags that gate
 *    delivery (language-owner approval).
 *
 * Pure (no I/O). Inlined into api/index.ts by scripts/inline-credit-file-engine.mjs.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { BUREAUS, parseMfsnPrintedAccounts, parseSmartCredit, parseSmartCreditPrintedLimits, type Bureau, type BureauTradeline, type CreditAccount, type CreditFile, type CreditInquiry, type ScPrintedLimit } from "./creditFile";
import {
  buildCreditAnalysis,
  isClosedTradeline,
  isNegativeTradeline,
  negativeKind,
  negativeLiftEstimate,
  parseReportDate,
} from "./creditAnalysisFromFile";

// ── types ───────────────────────────────────────────────────────────────────

export type Pv2Priority = "HIGH" | "MEDIUM" | "LOW";

export interface Pv2Win {
  item: string;
  bureaus: Bureau[];
  impact: Pv2Priority;
  status: "REMOVED" | "PARTIAL";
  /** Bureaus where it still reports (PARTIAL). */
  remainsOn: Bureau[];
  kind: "account" | "history" | "inquiry";
}

export interface Pv2Target {
  item: string;
  bureaus: Bureau[];
  detail: string;
  priority: Pv2Priority;
  lift: number;
  /** Spec v2 §5 typed round by item kind (R1 inquiries … R4) — never the case's pipeline round. */
  round?: 1 | 2 | 3 | 4;
  kind?: "account" | "inquiry";
  /** Internal accuracy flags (review queue), e.g. (e) past due ≥ balance with a recent payment. */
  accuracy?: string[];
  /** P0-4: added after the Before report date (NEW_NEGATIVE). */
  isNew?: boolean;
}

/** Spec §7 change-attribution causes (client copy states them as facts). */
export type Pv2Cause =
  | "CONFIRMED_WIN"
  | "PARTIAL_WIN"
  | "AU_TRADELINE_EFFECT"
  | "UTILIZATION_PAYDOWN"
  | "UTILIZATION_INCREASE"
  | "NEW_NEGATIVE_DEVELOPMENT"
  | "AGING_EFFECT"
  | "UNVERIFIED_MOVEMENT";

export interface Pv2BureauChange {
  removed: string[];
  added: string[];
  changed: string[];
}

export interface Pv2UtilRow {
  account: string;
  /** Bureau the row's numbers come from (totals use the overall bureau only). */
  bureau: Bureau;
  limit: number;
  baseline: number | null;
  current: number;
  pct: number;
  /** Target balance at 30% / 10% of the limit (kept for the round record). */
  payTo30: number;
  payTo10: number;
  /** P2-3: amount to pay down to reach 30% / 10% (0 = already there). What the PDF prints. */
  payDown30: number;
  payDown10: number;
}

export interface Pv2Diff {
  beforeDate: string | null;
  afterDate: string | null;
  wins: Pv2Win[];
  /** Client actions (payments / cures) — not dispute results. */
  clientActions: string[];
  targets: Pv2Target[];
  utilization: Pv2UtilRow[];
  utilizationOverall: { before: number | null; after: number | null; bureau: Bureau | null };
  utilizationNotes: string[];
  positives: string[];
  positivesFlags: { history: boolean; noCollections: boolean };
  /**
   * Internal: the accounts the positives name ("creditor|last4") and the non-inquiry targets' accounts.
   * The self-check compares accounts, not names — one creditor can hold a clean card and a late one.
   */
  positiveAccountKeys?: string[];
  targetAccountKeys?: string[];
  /** Internal only (case notes, never the client PDF). */
  internal: string[];
  /** Verified / resolved dispute remarks: "Verified - remains", informational until new evidence (PR-P1-4). */
  informational: Array<{ item: string; bureaus: Bureau[]; detail: string }>;
  /** Item-level diff per bureau (Spec §6), persisted with the round. */
  byBureau: Record<Bureau, Pv2BureauChange>;
  /** Spec §7: per-bureau score change and its causes (|Δ| ≥ 5). */
  attribution: Record<Bureau, { delta: number | null; causes: Pv2Cause[] }>;
  /** Client-facing facts behind the movement: wins first, then new negatives, then utilization. */
  movementFacts: string[];
  /** P0-4: NEW_NEGATIVE_DEVELOPMENT facts (always stated on page 1). */
  newNegativeFacts: string[];
  /** v2.1 §6 projection lift per bureau [low, high] (cumulative, capped +100). */
  projectionLift: Record<Bureau, [number, number]>;
  counts: { beforeAccounts: number; afterAccounts: number; beforeInquiries: number; afterInquiries: number };
  /** Open derogatory on AFTER (for file strength / caps). */
  after: {
    openDerogatory: number;
    derogatory: number;
    lates24m: boolean;
    olderLates: boolean;
    publicRecord: boolean;
    openRevolving: number;
    /** An OPEN account currently 90+ days late (caps payment history, PR-P0-7). */
    activeSevereDelinquency: boolean;
    /** OPEN accounts currently 90+ days late (major derogatories for the negatives component). */
    severeOpenAccounts: number;
    /** Years since the oldest account was opened (AFTER pull). */
    oldestYears: number | null;
    hasRevolving: boolean;
    hasInstallment: boolean;
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pv2Alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pv2MaskDigits(mask: string | null): string {
  return String(mask || "").replace(/[^0-9]/g, "");
}

function pv2OpenedMonth(a: CreditAccount): string | null {
  for (const b of BUREAUS) {
    const d = parseReportDate(a.bureaus[b]?.dateOpened);
    if (d) return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  }
  return null;
}

function pv2Limit(a: CreditAccount): number | null {
  for (const b of BUREAUS) {
    const v = a.bureaus[b]?.creditLimit ?? a.bureaus[b]?.highBalance;
    if (v) return v;
  }
  return null;
}

/**
 * Spec v1.1 §7 alias map: one furnisher printed several ways is one key
 * (NATIONSTAR/MR COOPER = NSTAR/COOPER; COMENITYCAP = COMENITY CAPITAL = CCB;
 * KCBCREDIT = KCB CREDIT L).
 */
const PV2_ALIASES: Array<[RegExp, string]> = [
  [/^(nationstar(mrcooper)?|nstar(mrcooper|cooper)?|mrcooper)/, "mrcooper"],
  [/^(comenitycap(ital)?(bank)?|ccb)$/, "comenitycapital"],
  [/^kcbcredit/, "kcbcredit"],
];

/** P1-5: strip spaces / punctuation and trailing L / LLC / INC / CORP / CO / NA, then aliases. */
export function pv2NormCreditor(s: string | null | undefined): string {
  let raw = String(s ?? "").trim();
  for (let i = 0; i < 2; i++) raw = raw.replace(/[\s,.]+(L|LLC|INC|CORP|CO|NA|N\.A)\.?$/i, "").trim();
  const a = pv2Alnum(raw);
  for (const [re, key] of PV2_ALIASES) if (re.test(a)) return key;
  return a;
}

/** Normalized Levenshtein similarity 0..1. */
function pv2Similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Same furnisher: normalized key equal, prefix containment, or fuzzy ≥ 0.9. */
export function pv2CreditorSimilar(x: string, y: string): boolean {
  const a = pv2NormCreditor(x).replace(/(bank)$/g, "");
  const b = pv2NormCreditor(y).replace(/(bank)$/g, "");
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) || pv2Similarity(a, b) >= 0.9;
}

/** Original amount for linking servicing transfers (high credit / limit). */
function pv2OriginalAmount(a: CreditAccount): number | null {
  for (const b of BUREAUS) {
    const v = a.bureaus[b]?.highBalance ?? a.bureaus[b]?.creditLimit;
    if (v) return v;
  }
  return null;
}

/**
 * §7 servicing: a mortgage that moved servicers (NATIONSTAR/MR COOPER ↔ FAY
 * SERVICING) reports as two tradelines with the same open month and original
 * amount — one loan, never "removed" while the other still carries the lates.
 */
export function pv2LinkedLoan(x: CreditAccount, y: CreditAccount): boolean {
  if (x === y) return false;
  const mortgage = (a: CreditAccount) => a.section === "mortgage" || /mortgage|real estate|conventional|fha|va loan/i.test(BUREAUS.map((b) => a.bureaus[b]?.accountType ?? "").join(" "));
  if (!mortgage(x) || !mortgage(y)) return false;
  const ox = pv2OpenedMonth(x);
  const ax = pv2OriginalAmount(x);
  return ox !== null && ox === pv2OpenedMonth(y) && ax !== null && ax === pv2OriginalAmount(y);
}

/** Opened (or first reported late) after the baseline — otherwise not a "new" negative. */
function pv2NewSince(a: CreditAccount, afterBase: (raw: string | null | undefined) => boolean): boolean {
  const opened = BUREAUS.map((b) => a.bureaus[b]?.dateOpened).find(Boolean);
  return afterBase(opened);
}

/**
 * Same creditor on several rows (three "Credit Collection Se" collections):
 * add the last 4 (or the amount) so the client can tell them apart (#6).
 */
function pv2Disambiguate<R extends { item: string }>(rows: R[], acctOf: (r: R) => CreditAccount | undefined, T: ReturnType<typeof pv2T>): void {
  const byLabel = new Map<string, R[]>();
  for (const r of rows) byLabel.set(r.item, [...(byLabel.get(r.item) ?? []), r]);
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    // First detail that tells EVERY row in the group apart: account number, open month, limit,
    // balance, bureaus — else a number. Rows missing that detail make it unusable.
    const tagOf = pv2DistinguishingTag(group.map(acctOf), T);
    group.forEach((r, i) => {
      const tag = tagOf(i);
      r.item = r.item.includes(" - ") ? r.item.replace(" - ", ` (${tag}) - `) : `${r.item} (${tag})`;
    });
  }
}

/** Picks one discriminator for a group of same-named accounts (unique for all of them). */
export function pv2DistinguishingTag(accts: Array<CreditAccount | undefined>, T: ReturnType<typeof pv2T>): (i: number) => string {
  const first = (a: CreditAccount | undefined, f: (t: BureauTradeline) => number | string | null | undefined) =>
    a ? BUREAUS.map((b) => (a.bureaus[b] ? f(a.bureaus[b]!) : null)).find((v) => v !== null && v !== undefined && v !== "" && v !== 0) ?? null : null;
  const openedMonth = (a: CreditAccount | undefined) => {
    const d = parseReportDate(first(a, (t) => t.dateOpened) as string | null);
    return d ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : null;
  };
  const candidates: Array<(a: CreditAccount | undefined) => string | null> = [
    (a) => (a && pv2Last4(a) ? T.endingIn(pv2Last4(a)) : null),
    (a) => {
      const m = openedMonth(a);
      return m ? T.opened(m) : null;
    },
    (a) => {
      const l = first(a, (t) => t.creditLimit) as number | null;
      return l ? T.limitTag(pv2Money(l)) : null;
    },
    (a) => {
      const b = first(a, (t) => t.balance) as number | null;
      return b ? pv2Money(b) : null;
    },
    (a) => (a ? BUREAUS.filter((b) => a.bureaus[b]).join("/") || null : null),
  ];
  for (const c of candidates) {
    const tags = accts.map(c);
    if (tags.every((t) => t) && new Set(tags).size === tags.length) return (i) => tags[i]!;
  }
  return (i) => `#${i + 1}`;
}

/** Last 4 of the account number (labels linked tradelines). */
function pv2NameKey(creditor: string): string {
  return creditor.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** "COMENITYCAPITALCHLD|8030" — one account (creditor + last 4; last 4 may be blank). */
export function pv2AccountKey(a: CreditAccount): string {
  return `${pv2NameKey(a.creditor)}|${pv2Last4(a)}`;
}

/** Same account: same creditor, and the same last 4 when both have one. */
export function pv2SameAccountKey(x: string, y: string): boolean {
  const [nx, lx] = x.split("|");
  const [ny, ly] = y.split("|");
  return nx === ny && (!lx || !ly || lx === ly);
}

function pv2Last4(a: CreditAccount): string {
  const d = pv2MaskDigits(a.mask);
  return d.length >= 4 ? d.slice(-4) : "";
}

/**
 * P1-4: item type from the account type + status fields (never remark
 * keywords). Late counts on an open / current tradeline = late payments;
 * collection only from the Collections section or a collection status.
 */
export function pv2ItemKind(a: CreditAccount, tls: BureauTradeline[]): "charge_off" | "collection" | "late" | "repossession" | "public_record" | "derogatory" {
  const status = tls.map((t) => `${t.paymentStatus ?? ""} ${t.accountStatus ?? ""} ${t.accountType ?? ""}`).join(" ");
  if (/bankrupt|judgment|lien/i.test(`${status} ${a.headerStatus ?? ""}`) || a.section === ("public_record" as string)) return "public_record";
  if (/repossess|foreclos/i.test(status)) return "repossession";
  if (a.section === "collection" || /collection/i.test(status)) return "collection";
  if (/charge.?off|charged off|written off/i.test(status)) return "charge_off";
  if (tls.some((t) => pv2Lates(t) > 0 || (t.pastDue ?? 0) > 0) || /late|past due|delinquen|\d{2,3}\s*days/i.test(status)) return "late";
  // Fall back to the shared classifier only for what status fields cannot type.
  const k = negativeKind(a, tls);
  return k === "collection" ? "derogatory" : k;
}

/** BEFORE↔AFTER account match: mask + open month; fallback creditor + month + limit. */
export function pv2MatchAccounts(before: CreditAccount[], after: CreditAccount[]): Map<CreditAccount, CreditAccount> {
  const out = new Map<CreditAccount, CreditAccount>();
  const used = new Set<CreditAccount>();
  // Among accounts that fit, the closest wins (Nov 6, 2026): look-alike loans share number and open
  // month, and the first fit could pair a loan with its sibling (wrong late / balance changes).
  const closeness = (b: CreditAccount, a: CreditAccount) => {
    let score = 0;
    for (const x of BUREAUS) {
      const tb = b.bureaus[x];
      const ta = a.bureaus[x];
      if (!tb || !ta) continue;
      score += 1;
      if (tb.balance != null && ta.balance != null) score += tb.balance === ta.balance ? 4 : Math.abs(tb.balance - ta.balance) <= Math.max(50, tb.balance * 0.1) ? 2 : 0;
      if (tb.creditLimit != null && tb.creditLimit === ta.creditLimit) score += 1;
    }
    if (pv2Last4(b) && pv2Last4(b) === pv2Last4(a)) score += 3;
    return score;
  };
  const tryMatch = (pred: (b: CreditAccount, a: CreditAccount) => boolean) => {
    for (const b of before) {
      if (out.has(b)) continue;
      let best: CreditAccount | null = null;
      let bestScore = -1;
      for (const x of after) {
        if (used.has(x) || !pred(b, x)) continue;
        const sc = closeness(b, x);
        if (sc > bestScore) {
          best = x;
          bestScore = sc;
        }
      }
      if (best) {
        out.set(b, best);
        used.add(best);
      }
    }
  };
  // 1) account number (shared 4+ leading digits) + same open month.
  tryMatch((b, a) => {
    const mb = pv2MaskDigits(b.mask);
    const ma = pv2MaskDigits(a.mask);
    const n = Math.min(mb.length, ma.length);
    return n >= 4 && mb.slice(0, n) === ma.slice(0, n) && pv2OpenedMonth(b) === pv2OpenedMonth(a) && pv2OpenedMonth(b) !== null;
  });
  // 2) creditor fuzzy + open month + limit / high balance.
  tryMatch((b, a) => {
    const lb = pv2Limit(b);
    const la = pv2Limit(a);
    return (
      pv2CreditorSimilar(b.creditor, a.creditor) &&
      pv2OpenedMonth(b) !== null &&
      pv2OpenedMonth(b) === pv2OpenedMonth(a) &&
      (lb === null || la === null || Math.abs(lb - la) <= 1 || pv2Alnum(b.creditor) === pv2Alnum(a.creditor))
    );
  });
  // 3) No open month (collections): same furnisher + section, then the same last 4, or the same balance on a shared bureau.
  tryMatch((b, a) => {
    if (b.section !== a.section || !pv2CreditorSimilar(b.creditor, a.creditor)) return false;
    const l4b = pv2Last4(b);
    const l4a = pv2Last4(a);
    if (l4b && l4a) return l4b === l4a;
    return BUREAUS.some((x) => b.bureaus[x] && a.bureaus[x] && b.bureaus[x]!.balance != null && b.bureaus[x]!.balance === a.bureaus[x]!.balance);
  });
  return out;
}

const pv2Lates = (t: BureauTradeline | undefined) => (t ? (t.late30 ?? 0) + (t.late60 ?? 0) + (t.late90 ?? 0) + (t.gridMarks?.length ?? 0) : 0);

function pv2LateDetail(a: CreditAccount): string {
  const parts: string[] = [];
  for (const b of BUREAUS) {
    const t = a.bureaus[b];
    if (!t || !(t.late30 || t.late60 || t.late90)) continue;
    const seg = [t.late30 ? `${t.late30}x30` : "", t.late60 ? `${t.late60}x60` : "", t.late90 ? `${t.late90}x90` : ""].filter(Boolean).join(", ");
    parts.push(`${b} ${seg}`);
  }
  return parts.join("; ");
}

function pv2Priority(kind: string): Pv2Priority {
  return kind === "charge_off" || kind === "collection" || kind === "repossession" || kind === "public_record" ? "HIGH" : kind === "late" ? "MEDIUM" : "LOW";
}

const pv2Money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── input hygiene (Progress Report Engine Spec v1, Oct 22 2026) ────────────

/**
 * PR-P0-2 / PR-P0-4: table-of-contents lines ("10. Collections 53", "2.1 Macys
 * 4"), page footers and Payment Summary row labels are never items.
 */
const PV2_TEMPLATE_LABEL =
  /^(reported|account number|account status|credit limit|high credit|reported balance|balance|(30|60|90|120|150|180)\+? days?( past due| late)?|collection account|charge ?off|included in( -)? ?bankruptcy|repossession|too new to rate|no data available|amount( past due)?|month reviewed|payment status|current account\/was \d+ days|past due|status|remarks?|creditor|date opened)(\s*\(?(TU|EX|EQ|TransUnion|Experian|Equifax)\)?)?(\s+-\s.*|\s*:.*)?$/i;
// Section-numbered lines, "Collections 53"-style headings with a page number,
// and page footers. (A creditor ending in digits, e.g. "CAPITAL ONE 360", is fine.)
const PV2_TOC_LINE =
  /^\s*\d+\.(\d+)?\s|^(report summary|personal information|revolving|installment|mortgage|other|collections?|inquiries|public records?|soft inquiries)( accounts)?\s+\d{1,3}$|three bureau credit report|page \d+ of \d+|^\s*\d+\s*$/i;

export function pv2IsJunkItem(label: string | null | undefined): boolean {
  const s = String(label ?? "").trim();
  if (!s || s.length < 2) return true;
  return PV2_TEMPLATE_LABEL.test(s) || PV2_TOC_LINE.test(s);
}

/**
 * PR-P1-8: remarks must not carry the creditor address / phone column
 * ("LAST PAID: 09/2026 CAPITAL ONE BANK USA", "PO BOX 1234 ...").
 */
export function pv2CleanRemarks(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw);
  // Trailing creditor name after "LAST PAID: MM/YYYY" (bank-like words only; never
  // dispute / status / payment wording, which must survive for dispute holds).
  s = s.replace(/(LAST PAID:?\s*\d{1,2}\/\d{4})\s+([A-Z][A-Z0-9 .,&'\/-]{3,})$/, (whole, paid: string, tail: string) =>
    /\b(BANK|USA|N\.?A\.?|LLC|INC|CORP|FINANCIAL|FUNDING|CAPITAL|FINANCE|CARD|CU)\b/.test(tail) &&
    !/DISPUT|REINVESTIG|PAST DUE|CHARGE|COLLECT|ACCOUNT|CLOSED|PAID|DAYS|LATE|CONSUMER|GRANTOR|RESOLVED|VERIFIED/.test(tail)
      ? paid
      : whole,
  );
  s = s.replace(/\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, "");
  s = s.replace(/\b(P\.?\s?O\.?\s?BOX\s+\d+|\d{2,6}\s+[A-Z0-9 .]{2,40}\b(ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|DR|DRIVE|WAY|PKWY|HWY|LN|CT|PL|SUITE|STE)\b).*$/i, "");
  s = s.replace(/\s{2,}/g, " ").replace(/[\s;,-]+$/, "").trim();
  return s || null;
}

/** Sanitized copy: junk accounts / inquiries dropped, remarks cleaned. */
export function pv2SanitizeFile(f: CreditFile): { file: CreditFile; dropped: string[] } {
  const dropped: string[] = [];
  const accounts = f.accounts
    .filter((a) => {
      if (pv2IsJunkItem(a.creditor)) {
        dropped.push(a.creditor);
        return false;
      }
      return true;
    })
    .map((a) => ({
      ...a,
      bureaus: Object.fromEntries(
        Object.entries(a.bureaus).map(([b, t]) => [b, t ? { ...t, remarks: pv2CleanRemarks(t.remarks) } : t]),
      ) as CreditAccount["bureaus"],
    }));
  const inquiries = f.inquiries.filter((q) => {
    if (pv2IsJunkItem(q.creditor)) {
      dropped.push(q.creditor);
      return false;
    }
    return true;
  });
  return { file: { ...f, accounts, inquiries }, dropped };
}

/**
 * PR-P0-5: identical pulls block generation (BLOCKED_DATA_INTEGRITY): same
 * report date, same file hash, or identical scores + balances on every
 * tradeline. Returns the reason, or null.
 */
export function pv2DataIntegrity(
  before: CreditFile,
  after: CreditFile,
  hashes: { before?: string | null; after?: string | null } = {},
): string | null {
  if (hashes.before && hashes.after && hashes.before === hashes.after) return "Before and After are the same file";
  const bd = parseReportDate(before.reportDate);
  const ad = parseReportDate(after.reportDate);
  if (bd && ad && bd.getTime() === ad.getTime()) return `Before and After have the same report date (${after.reportDate})`;
  const sameScores = BUREAUS.every((b) => before.scores[b] === after.scores[b]);
  if (sameScores && before.accounts.length === after.accounts.length && before.accounts.length > 0) {
    const sig = (f: CreditFile) =>
      f.accounts
        .map((a) => `${pv2Alnum(a.creditor)}|${BUREAUS.map((b) => a.bureaus[b]?.balance ?? "-").join(",")}`)
        .sort()
        .join(";");
    if (sig(before) === sig(after)) return "Before and After are identical (same scores and balances on every tradeline)";
  }
  return null;
}

/**
 * PR-P1-7: "LAST REPORTED DELINQUENCIES: 07/2026=I5, 08/2026=I5" and grid
 * marks → months with their level (2:30, 3:60, 4:90, 5:120+).
 */
export function pv2DelinquencyMonths(t: BureauTradeline | undefined): Array<{ month: Date; level: number; label: string }> {
  if (!t) return [];
  const out: Array<{ month: Date; level: number; label: string }> = [];
  const re = /(\d{1,2})\/(\d{4})\s*=\s*([IRMOC])(\d)/gi;
  for (const m of String(t.remarks ?? "").matchAll(re)) {
    out.push({ month: new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1)), level: Number(m[4]), label: `${m[1].padStart(2, "0")}/${m[2]}` });
  }
  for (const g of t.gridMarks ?? []) {
    const [mm, code] = String(g).split(":");
    const d = parseReportDate(mm);
    if (!d) continue;
    const n = Number(String(code).replace(/\D/g, ""));
    const level = /co|cl|ch/i.test(code ?? "") ? 6 : n >= 150 ? 6 : n >= 120 ? 5 : n >= 90 ? 4 : n >= 60 ? 3 : n >= 30 ? 2 : 2;
    out.push({ month: d, level, label: mm });
  }
  return out;
}

// ── client-facing text (EN / ES) ────────────────────────────────────────────

export type Pv2Lang = "en" | "es";

function pv2T(lang: Pv2Lang) {
  const es = lang === "es";
  const kindName = (k: string) =>
    es
      ? ({ charge_off: "Cargo a perdida", collection: "Cobranza", late: "Pagos atrasados", repossession: "Reposesion", public_record: "Registro publico" } as Record<string, string>)[k] ?? "Negativa"
      : ({ charge_off: "Charge-off", collection: "Collection", late: "Late payments", repossession: "Repossession", public_record: "Public record" } as Record<string, string>)[k] ?? "Derogatory";
  return {
    winSuffix: (k: string) =>
      k === "late" ? (es ? " - pago atrasado" : " - late payment") : k === "charge_off" ? (es ? " - cargo a perdida" : " - charge-off") : k === "collection" ? (es ? " - cobranza" : " - collection") : "",
    inquiries: (names: string) => (es ? `Consultas de credito (${names})` : `Hard inquiries (${names})`),
    clientAction: (creditor: string, was: string | null, pd: string | null, closedPaid: boolean) =>
      es
        ? `${creditor} paso de ${was ? was.toLowerCase() : "pago vencido"}${pd ? ` (${pd} vencido)` : ""} a ${closedPaid ? "cerrada y pagada" : "al corriente"} con $0 vencido`
        : `${creditor} went from ${was ? was.toLowerCase() : "past due"}${pd ? ` (${pd} past due)` : ""} to ${closedPaid ? "closed paid" : "Current"} with $0 past due`,
    kindName,
    chargedOff: (m: string) => (es ? `${m} cargado a perdida` : `${m} charged off`),
    inCollection: (m: string) => (es ? `${m} en cobranza` : `${m} in collection`),
    pastDue: (m: string) => (es ? `${m} vencido` : `${m} past due`),
    nowCurrent: es ? "ya al corriente" : "now current",
    limitChanged: (acct: string, up: boolean, from: string, to: string) =>
      es ? `El limite de ${acct} ${up ? "subio" : "bajo"} de ${from} a ${to} desde la linea base.` : `${acct} limit ${up ? "increased" : "decreased"} from ${from} to ${to} since baseline.`,
    notReporting: (m: string, acct: string, bureaus: string) =>
      es ? `La linea de ${m} de ${acct} no se esta reportando en ${bureaus}.` : `The ${m} ${acct} line is not currently reporting on ${bureaus}.`,
    noCollections: es ? "Sin cobranzas, registros publicos ni bancarrotas en ningun buro." : "No collections, public records, or bankruptcies on any bureau.",
    historySince: (y: number, c: string) => (es ? `Historial de credito desde ${y} (${c}).` : `Credit history dating back to ${y} (${c}).`),
    paidLoans: (n: number) => (es ? `${n} ${n === 1 ? "prestamo cerrado y pagado" : "prestamos cerrados y pagados"} segun lo acordado.` : `${n} installment ${n === 1 ? "loan" : "loans"} closed paid as agreed.`),
    totalLimits: (m: string, zero: string) =>
      es ? `Cerca de ${m} en limites revolventes abiertos${zero ? `, incluyendo lineas en $0 en ${zero}` : ""}.` : `About ${m} in open revolving limits${zero ? `, including $0-balance lines at ${zero}` : ""}.`,
    allCurrent: es ? "Todas las cuentas abiertas se reportan al corriente." : "All open accounts are reporting Current.",
    verifiedRemains: es ? "Verificado - permanece" : "Verified - remains",
    inquiryTarget: (c: string, d: string) => (es ? `${c} - Consulta de credito ${d}` : `${c} - Hard inquiry ${d}`),
    factNewLate: (c: string, months: string[]) =>
      es
        ? `${c} reporto nuevos pagos atrasados${months.length ? ` (${months.join(", ")})` : ""}.`
        : `${c} reported new late payments${months.length ? ` (${months.join(", ")})` : ""}.`,
    factUtil: (b: number, a: number) =>
      es ? `La utilizacion revolvente ${a > b ? "subio" : "bajo"} de ${b}% a ${a}%.` : `Revolving utilization ${a > b ? "rose" : "dropped"} from ${b}% to ${a}%.`,
    factRemoved: (item: string) => (es ? `Eliminado: ${item}.` : `Removed: ${item}.`),
    factNewInquiry: (c: string, d: string, b: string) => (es ? `Nueva consulta de credito: ${c} ${d} (${b}).` : `New hard inquiry: ${c} ${d} (${b}).`),
    factNewAccount: (c: string, k: string, b: string) => (es ? `Nueva cuenta negativa: ${c} - ${k} (${b}).` : `New negative account: ${c} - ${k} (${b}).`),
    newSinceBefore: es ? "Nueva desde el reporte anterior" : "New since the prior report",
    disputeInProgress: es ? "disputa en curso: esperamos la respuesta del buro" : "dispute in progress: waiting on the bureau's answer",
    opened: (d: string) => (es ? `abierta ${d}` : `opened ${d}`),
    endingIn: (l4: string) => (es ? `termina en ${l4}` : `acct ending ${l4}`),
    limitTag: (m: string) => (es ? `limite ${m}` : `${m} limit`),
    progressButStill: (line: string, b: string) =>
      es ? `${line}; los pagos atrasados anteriores siguen reportandose en ${b}` : `${line}; the earlier late marks are still reporting on ${b}`,
    flagE: es ? "el vencido iguala el saldo aunque se registran pagos (en revision)" : "past due equals the balance while payments post (under review)",
    flagF: (detail: string) => (es ? `los buros reportan distintos atrasos (${detail})` : `bureaus report different late counts (${detail})`),
  };
}

/**
 * Spec v1 PR-P1-5 accuracy flags on an AFTER account (internal / review):
 * (e) past due ≥ balance while a payment posted in the last reporting cycle;
 * (f) bureaus disagree on late counts for the same tradeline.
 */
export function pv2AccuracyFlags(a: CreditAccount, afterDate: Date | null): string[] {
  const flags: string[] = [];
  const now = afterDate ?? new Date();
  for (const b of BUREAUS) {
    const t = a.bureaus[b];
    if (!t || !(t.pastDue && t.balance) || t.pastDue < t.balance * 0.98) continue;
    const lp = parseReportDate(t.lastPayment) ?? (() => {
      const m = /LAST PAID:?\s*(\d{1,2})\/(\d{4})/i.exec(t.remarks ?? "");
      return m ? new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1)) : null;
    })();
    if (lp && now.getTime() - lp.getTime() <= 62 * 86_400_000) {
      flags.push(`(e) past due $${Math.round(t.pastDue)} >= balance $${Math.round(t.balance)} with a payment in the last cycle (${b})`);
      break;
    }
  }
  const lateSig = BUREAUS.filter((b) => a.bureaus[b]).map((b) => {
    const t = a.bureaus[b]!;
    return { b, sig: `${t.late30 ?? 0}/${t.late60 ?? 0}/${t.late90 ?? 0}` };
  });
  if (lateSig.length >= 2 && new Set(lateSig.map((x) => x.sig)).size > 1 && lateSig.some((x) => x.sig !== "0/0/0")) {
    flags.push(`(f) late counts differ by bureau (${lateSig.map((x) => `${x.b} ${x.sig}`).join(", ")})`);
  }
  return flags;
}

// ── diff engine ─────────────────────────────────────────────────────────────

export function pv2Diff(rawBefore: CreditFile, rawAfter: CreditFile, lang: Pv2Lang = "en"): Pv2Diff {
  const T = pv2T(lang);
  const sb = pv2SanitizeFile(rawBefore);
  const sa = pv2SanitizeFile(rawAfter);
  const before = sb.file;
  const after = sa.file;
  const afterDate = parseReportDate(after.reportDate);
  const matches = pv2MatchAccounts(before.accounts, after.accounts);
  const matchedAfter = new Set(matches.values());
  const wins: Pv2Win[] = [];
  /** Win → its BEFORE account (state resolution against remaining targets). */
  const winSources = new Map<Pv2Win, CreditAccount>();
  const clientActions: string[] = [];
  /** Parallel to clientActions: the AFTER account behind each line. */
  const clientActionAccounts: CreditAccount[] = [];
  const internal: string[] = [];
  const junk = [...new Set([...sb.dropped, ...sa.dropped])];
  if (junk.length) internal.push(`Dropped template / table-of-contents rows (not items): ${junk.slice(0, 8).join(", ")}`);
  const negBureaus = (a: CreditAccount) => BUREAUS.filter((b) => a.bureaus[b] && isNegativeTradeline(a.bureaus[b]!, a));

  // Unmatched AFTER accounts (candidates for re-reports).
  const unmatchedAfter = after.accounts.filter((a) => !matchedAfter.has(a));

  for (const b of before.accounts) {
    const nb = negBureaus(b);
    if (!nb.length) continue;
    const a = matches.get(b);
    const kind = pv2ItemKind(b, nb.map((x) => b.bureaus[x]!));
    const deletedOn = nb.filter((x) => !a?.bureaus[x]);
    const stillNeg = a ? nb.filter((x) => a.bureaus[x] && isNegativeTradeline(a.bureaus[x]!, a)) : [];
    const cleanedOn = a ? nb.filter((x) => a.bureaus[x] && !stillNeg.includes(x)) : [];

    // Re-report: "removed" here, but an unmatched AFTER account with the same
    // open month + limit appeared (new name / number). Not a win.
    if (deletedOn.length) {
      const re = unmatchedAfter.find((x) => pv2OpenedMonth(x) === pv2OpenedMonth(b) && pv2OpenedMonth(b) !== null && pv2Limit(x) !== null && pv2Limit(x) === pv2Limit(b) && deletedOn.some((d) => x.bureaus[d]));
      if (re) {
        internal.push(`Re-report (not a win): ${b.creditor} on ${deletedOn.filter((d) => re.bureaus[d]).join("/")} re-reported as ${re.creditor}`);
        deletedOn.splice(0, deletedOn.length, ...deletedOn.filter((d) => !re.bureaus[d]));
      }
    }

    // No longer negative on a bureau BECAUSE the late history was corrected
    // (a dispute result). Only a payment bringing it current is NOT a win.
    const historyCorrected = cleanedOn.filter(
      (x) =>
        pv2Lates(a!.bureaus[x]) < pv2Lates(b.bureaus[x]) ||
        (pv2Lates(b.bureaus[x]) === 0 && (b.bureaus[x]!.pastDue ?? 0) === 0 && !/past due|late/i.test(`${a!.bureaus[x]!.paymentStatus || ""}`)),
    );

    const removedOn = [...deletedOn, ...historyCorrected];
    if (removedOn.length) {
      const remainsOn = nb.filter((x) => !removedOn.includes(x));
      const label = b.creditor + T.winSuffix(kind);
      const win: Pv2Win = {
        item: label,
        bureaus: removedOn,
        impact: remainsOn.length ? "MEDIUM" : pv2Priority(kind) === "LOW" ? "MEDIUM" : "HIGH",
        status: remainsOn.length ? "PARTIAL" : "REMOVED",
        remainsOn,
        kind: deletedOn.length ? "account" : "history",
      };
      wins.push(win);
      winSources.set(win, b);
    }
  }

  // Client-action cures (any matched account): past due → $0, late status →
  // Current, or closed paid. Labeled separately — never a dispute win.
  for (const [b, a] of matches) {
    const cureOn = BUREAUS.filter((x) => {
      const tb = b.bureaus[x];
      const ta = a.bureaus[x];
      if (!tb || !ta) return false;
      const wasPastDue = (tb.pastDue ?? 0) > 0 || /past due|late/i.test(tb.paymentStatus || "");
      const nowOk = (ta.pastDue ?? 0) === 0 && !/past due|late/i.test(ta.paymentStatus || "");
      return wasPastDue && nowOk;
    });
    if (!cureOn.length) continue;
    const pd = Math.max(...cureOn.map((x) => b.bureaus[x]!.pastDue ?? 0));
    const lateWas = cureOn.map((x) => b.bureaus[x]!.paymentStatus).find((s) => s && /late/i.test(s));
    const closedPaid = cureOn.some((x) => isClosedTradeline(a.bureaus[x]!, a));
    clientActions.push(T.clientAction(a.creditor, lateWas ?? null, pd > 0 ? pv2Money(pd) : null, closedPaid));
    clientActionAccounts.push(a);
  }

  // Late counts that went UP on an existing account (internal flag).
  for (const [b, a] of matches) {
    for (const x of BUREAUS) {
      if (a.bureaus[x] && b.bureaus[x] && pv2Lates(a.bureaus[x]) > pv2Lates(b.bureaus[x])) {
        internal.push(`${x} late count +${pv2Lates(a.bureaus[x]) - pv2Lates(b.bureaus[x])} on ${a.creditor}`);
      }
    }
  }

  // Inquiries: removed (< 24 months before AFTER date) = win; older = aged off.
  // §7 inquiry_key = (normalize(company), inquiry_date, bureau): KCB CREDIT / KCBCREDIT / KCB CREDIT L are one company.
  const qDate = (d: string) => {
    const x = parseReportDate(d);
    return x ? x.toISOString().slice(0, 10) : d.trim();
  };
  // One canonical company per similar name across both pulls (UNISOURCE CR = UNISOURCE CREDIT LLC;
  // PATHWARD NA/OPORTUN = OPORTUN): keys, rows and conflicts all use the canonical spelling.
  const canon = new Map<string, string>();
  const canonNames: string[] = [];
  for (const q of [...after.inquiries, ...before.inquiries]) {
    const n = pv2NormCreditor(q.creditor);
    if (canon.has(n)) continue;
    const hit = canonNames.find((c) => pv2CreditorSimilar(c, n));
    canon.set(n, hit ?? n);
    if (!hit) canonNames.push(n);
  }
  const display = new Map<string, string>();
  for (const q of after.inquiries) if (!display.has(canon.get(pv2NormCreditor(q.creditor))!)) display.set(canon.get(pv2NormCreditor(q.creditor))!, q.creditor);
  for (const q of before.inquiries) if (!display.has(canon.get(pv2NormCreditor(q.creditor))!)) display.set(canon.get(pv2NormCreditor(q.creditor))!, q.creditor);
  const qCo = (c: string) => canon.get(pv2NormCreditor(c)) ?? pv2NormCreditor(c);
  const qName = (c: string) => display.get(qCo(c)) ?? c;
  const qKey = (q: { creditor: string; bureau: Bureau | null; date: string }) => `${qCo(q.creditor)}|${q.bureau}|${qDate(q.date)}`;
  const afterQ = new Set(after.inquiries.map(qKey));
  const beforeQ = new Set(before.inquiries.map(qKey));
  const removedQ = before.inquiries.filter((q) => !afterQ.has(qKey(q)));
  const inquiryWins = removedQ.filter((q) => {
    const d = parseReportDate(q.date);
    return !d || !afterDate || afterDate.getTime() - d.getTime() < 730 * 86_400_000;
  });
  const agedOff = removedQ.filter((q) => !inquiryWins.includes(q));
  if (agedOff.length) internal.push(`Aged off (not a win): ${agedOff.map((q) => `${q.creditor} ${q.bureau ?? "N/I"}`).join(", ")}`);
  // P1-5: one row per inquiry (company + date) with its bureaus — no ellipses, counts = rows.
  const inqWinGroups = new Map<string, { creditor: string; date: string; bureaus: Bureau[] }>();
  for (const q of inquiryWins) {
    const k = `${qCo(q.creditor)}|${qDate(q.date)}`;
    const g = inqWinGroups.get(k) ?? { creditor: qName(q.creditor), date: q.date, bureaus: [] as Bureau[] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    inqWinGroups.set(k, g);
  }
  for (const g of inqWinGroups.values()) {
    wins.push({ item: T.inquiryTarget(g.creditor, g.date), bureaus: g.bureaus, impact: "LOW", status: "REMOVED", remainsOn: [], kind: "inquiry" });
  }
  const baseDate = parseReportDate(before.reportDate);
  /** New = dated after the Before report date. Undated or older items that the Before read lacks are not "new". */
  const afterBase = (raw: string | null | undefined) => {
    const d = parseReportDate(raw);
    return !!d && (!baseDate || d.getTime() > baseDate.getTime());
  };
  const newQ = after.inquiries.filter((q) => !beforeQ.has(qKey(q)) && afterBase(q.date));
  if (newQ.length) internal.push(`New inquiries: ${newQ.map((q) => `${q.creditor} ${q.bureau ?? "N/I"} ${q.date}`).join(", ")}`);

  // Targets: every remaining negative on AFTER, typed by the v2 engine
  // (Section 5 rounds, dispute holds, public-record rule, accuracy flags).
  // Typing is an enhancement: an odd file never breaks the report.
  let analysis: Pick<ReturnType<typeof buildCreditAnalysis>, "negatives" | "inquiries" | "informational" | "projections">;
  try {
    analysis = buildCreditAnalysis(after);
  } catch (e) {
    internal.push(`Round typing unavailable (${(e as Error)?.message ?? e}) — targets listed without R1-R4.`);
    analysis = { negatives: [], inquiries: [], informational: [], projections: [] };
  }
  const analysisFor = (a: CreditAccount) =>
    analysis.negatives.find((n) => pv2Alnum(n.creditor) === pv2Alnum(a.creditor) && (!n.mask || !a.mask || pv2MaskDigits(n.mask).slice(-4) === pv2MaskDigits(a.mask).slice(-4))) ??
    analysis.negatives.find((n) => pv2CreditorSimilar(n.creditor, a.creditor));
  const informational: Pv2Diff["informational"] = [];
  const targets: Pv2Target[] = [];
  /** Target → its AFTER account (labels for same-name accounts). */
  const targetSources = new Map<Pv2Target, CreditAccount>();
  const targetFor = (a: CreditAccount, t: Pv2Target) => {
    targetSources.set(t, a);
    return t;
  };
  for (const a of after.accounts) {
    const na = negBureaus(a);
    if (!na.length) continue;
    const tls = na.map((x) => a.bureaus[x]!);
    const kind = pv2ItemKind(a, tls);
    // Bankruptcy / public-record targets only when the Public Records section has entries.
    if (kind === "public_record" && after.publicRecordsReported !== true) {
      internal.push(`Public-record row ignored (no public records on the file): ${a.creditor}`);
      continue;
    }
    const typed = analysisFor(a);
    // Resolved / verified dispute (v2 P1-5): the v2 engine lists it as informational.
    // Verified = a resolved / verified dispute remark. The analysis also lists ACTIVE disputes as
    // informational (note "Active dispute…"); those are not verifications.
    const verified = (analysis.informational ?? []).find((i) => pv2CreditorSimilar(i.creditor, a.creditor) && !/^active dispute/i.test(i.note ?? ""));
    // An open dispute is not a bureau verification: it stays a target ("dispute in progress"),
    // never "Verified - remains" (one classification per account, Cesar #7).
    const activeDispute =
      !verified &&
      ((!!typed?.hold && /active dispute/i.test(typed.holdReason ?? "")) ||
        (analysis.informational ?? []).some((i) => pv2CreditorSimilar(i.creditor, a.creditor) && /^active dispute/i.test(i.note ?? "")));
    if (activeDispute) internal.push(`Dispute in progress (not re-disputed until it closes): ${a.creditor}`);
    if ((typed?.hold || verified) && !activeDispute) {
      informational.push({ item: `${a.creditor} - ${T.kindName(kind)}`, bureaus: na, detail: T.verifiedRemains });
      internal.push(`Verified dispute (informational until new evidence): ${a.creditor} — ${typed?.holdReason ?? "dispute resolved / verified remark"}`);
      for (const f of pv2AccuracyFlags(a, afterDate)) internal.push(`Accuracy flag ${f} — ${a.creditor}`);
      continue;
    }
    const amount = Math.max(...tls.map((t) => (kind === "charge_off" || kind === "collection" ? t.balance ?? 0 : t.pastDue ?? 0)));
    const isNew = ![...matches.values()].includes(a) && pv2NewSince(a, afterBase);
    if (isNew) internal.push(`New negative: ${a.creditor} (${na.join("/")})`);
    else if (![...matches.values()].includes(a)) {
      const opened = BUREAUS.map((b) => a.bureaus[b]?.dateOpened).find(Boolean);
      internal.push(`Not on the Before read (${opened ? `opened ${opened}, before the baseline` : "no open date"} — check the Before pull): ${a.creditor} (${na.join("/")})`);
    }
    const detail = [
      kind === "charge_off" && amount ? T.chargedOff(pv2Money(amount)) : kind === "collection" && amount ? T.inCollection(pv2Money(amount)) : "",
      pv2LateDetail(a),
      kind !== "charge_off" && kind !== "collection" && amount ? T.pastDue(pv2Money(amount)) : "",
      tls.some((t) => /current/i.test(t.paymentStatus || "")) && pv2LateDetail(a) ? T.nowCurrent : "",
    ]
      .filter(Boolean)
      .join("; ");
    const accuracy = pv2AccuracyFlags(a, afterDate);
    for (const f of accuracy) internal.push(`Accuracy flag ${f} — ${a.creditor}`);
    // P1-7: flags show in the target Detail (facts) as well as the internal note.
    const flagText = accuracy.map((f) => (f.startsWith("(e)") ? T.flagE : T.flagF(/\((?:[A-Z]{2} [^)]*)\)$/.exec(f)?.[0]?.slice(1, -1) ?? "")));
    // Servicing transfers: label with last 4 + date opened so the client can tell them apart.
    const linked = after.accounts.find((o) => pv2LinkedLoan(a, o));
    const opened = BUREAUS.map((b) => a.bureaus[b]?.dateOpened).find(Boolean);
    const label = linked ? `${a.creditor} (${pv2Last4(a) ? `${T.endingIn(pv2Last4(a))}, ` : ""}${T.opened(opened ?? "--")})` : a.creditor;
    if (linked) internal.push(`Linked servicing tradelines (one loan): ${a.creditor} <-> ${linked.creditor}`);
    targets.push(targetFor(a, {
      item: `${label} - ${T.kindName(kind)}`,
      bureaus: na,
      detail: [detail || (tls[0].paymentStatus ?? ""), ...flagText, activeDispute ? T.disputeInProgress : ""].filter(Boolean).join("; "),
      ...(isNew ? { isNew: true } : {}),
      priority: pv2Priority(kind),
      lift: negativeLiftEstimate(kind, tls.map((t) => `${t.paymentStatus || ""} ${t.remarks || ""}`).join(" ")),
      round: (typed?.round as 1 | 2 | 3 | 4 | undefined) ?? (kind === "collection" ? 2 : kind === "public_record" ? 4 : 3),
      kind: "account",
      ...(accuracy.length ? { accuracy } : {}),
    }));
  }
  // Remaining disputable inquiries (Round 1), per bureau as itemized on the pull.
  const inqGroups = new Map<string, { creditor: string; date: string; bureaus: Bureau[] }>();
  for (const q of analysis.inquiries.filter((x) => x.action === "dispute")) {
    const k = `${qCo(q.creditor)}|${qDate(q.date)}`;
    const g = inqGroups.get(k) ?? { creditor: qName(q.creditor), date: q.date, bureaus: [] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    inqGroups.set(k, g);
  }
  // P0-4: inquiries added after the Before date are NEW_NEGATIVE and always Round 1 targets.
  for (const q of newQ) {
    const k = `${qCo(q.creditor)}|${qDate(q.date)}`;
    const g = inqGroups.get(k) ?? { creditor: qName(q.creditor), date: q.date, bureaus: [] as Bureau[] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    inqGroups.set(k, g);
  }
  const newInqKeys = new Set(newQ.map((q) => `${qCo(q.creditor)}|${qDate(q.date)}`));
  for (const [k, g] of inqGroups) {
    targets.push({
      item: T.inquiryTarget(g.creditor, g.date),
      bureaus: g.bureaus,
      detail: newInqKeys.has(k) ? T.newSinceBefore : "",
      priority: "LOW",
      lift: 5,
      round: 1,
      kind: "inquiry",
      ...(newInqKeys.has(k) ? { isNew: true } : {}),
    });
  }

  // ── P0-2: one state per item per bureau ──────────────────────────────────
  // A win can never sit on a bureau where the same account (alias / linked
  // servicing tradeline) or the same inquiry is still a target.
  const accountTargets = after.accounts.filter((a) => negBureaus(a).length);
  const sameItem = (winItem: Pv2Win, beforeAcct: CreditAccount | undefined, targetAcct: CreditAccount) =>
    !!beforeAcct && (pv2CreditorSimilar(beforeAcct.creditor, targetAcct.creditor) || pv2LinkedLoan(beforeAcct, targetAcct) || matches.get(beforeAcct) === targetAcct);
  for (let wi = wins.length - 1; wi >= 0; wi--) {
    const w = wins[wi];
    let stillOn: Bureau[] = [];
    if (w.kind === "inquiry") {
      const key = w.item;
      stillOn = targets.filter((t) => t.kind === "inquiry" && t.item === key).flatMap((t) => t.bureaus);
    } else {
      const src = winSources.get(w);
      stillOn = accountTargets.filter((a) => sameItem(w, src, a)).flatMap((a) => negBureaus(a));
    }
    const conflict = w.bureaus.filter((b) => stillOn.includes(b));
    if (!conflict.length) continue;
    const keep = w.bureaus.filter((b) => !conflict.includes(b));
    internal.push(`State conflict resolved (still reporting, not a win): ${w.item} on ${conflict.join("/")}`);
    if (!keep.length) wins.splice(wi, 1);
    else {
      w.bureaus = keep;
      w.remainsOn = [...new Set([...w.remainsOn, ...conflict])];
      w.status = "PARTIAL";
      w.impact = "MEDIUM";
    }
  }
  // CLIENT_PROGRESS + REMAINS_TARGET on one account: say both plainly in one line.
  for (let ci = 0; ci < clientActionAccounts.length; ci++) {
    const a = clientActionAccounts[ci];
    const still = negBureaus(a);
    if (still.length) clientActions[ci] = T.progressButStill(clientActions[ci], still.join("/"));
  }
  targets.sort((x, y) => ["HIGH", "MEDIUM", "LOW"].indexOf(x.priority) - ["HIGH", "MEDIUM", "LOW"].indexOf(y.priority));
  pv2Disambiguate(wins, (w) => winSources.get(w), T);
  pv2Disambiguate(
    targets.filter((t) => t.kind !== "inquiry"),
    (t) => targetSources.get(t),
    T,
  );
  // A target whose creditor name also belongs to another account on the file (e.g. a clean card in
  // Positives): name the card so the client can tell them apart.
  for (const t of targets) {
    const a = targetSources.get(t);
    if (!a || /\((acct ending|termina en|opened|abierta) /.test(t.item)) continue;
    const others = after.accounts.filter((x) => x !== a && pv2NameKey(x.creditor) === pv2NameKey(a.creditor));
    if (!others.length) continue;
    const tag = pv2DistinguishingTag([a, ...others], T)(0);
    if (tag.startsWith("#")) continue;
    t.item = t.item.includes(" - ") ? t.item.replace(" - ", ` (${tag}) - `) : `${t.item} (${tag})`;
  }

  // Utilization: every OPEN revolving AFTER account with a limit; one bureau
  // per row (TU, then EX, then EQ), baseline from the matched BEFORE account.
  const utilization: Pv2UtilRow[] = [];
  const utilizationNotes: string[] = [];
  const revOpen = after.accounts.filter((a) => a.section === "revolving" && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)));
  for (const a of revOpen) {
    const b = BUREAUS.find((x) => a.bureaus[x]?.creditLimit);
    if (!b) continue;
    const t = a.bureaus[b]!;
    const limit = t.creditLimit!;
    const cur = Math.max(0, t.balance ?? 0);
    const prior = [...matches.entries()].find(([, v]) => v === a)?.[0];
    const baseline = prior?.bureaus[b]?.balance ?? null;
    const priorLimit = prior?.bureaus[b]?.creditLimit ?? null;
    if (priorLimit && priorLimit !== limit) {
      utilizationNotes.push(T.limitChanged(a.creditor, limit > priorLimit, pv2Money(priorLimit), pv2Money(limit)));
    }
    const missing = BUREAUS.filter((x) => (after.scores[x] !== null) && !a.bureaus[x]);
    if (missing.length && limit >= 5000) {
      utilizationNotes.push(T.notReporting(pv2Money(limit), a.creditor, missing.join("/")));
    }
    utilization.push({
      account: a.creditor,
      bureau: b,
      limit,
      baseline,
      current: cur,
      pct: Math.round((cur / limit) * 100),
      payTo30: Math.floor(limit * 0.3),
      payTo10: Math.floor(limit * 0.1),
      payDown30: Math.max(0, cur - Math.floor(limit * 0.3)),
      payDown10: Math.max(0, cur - Math.floor(limit * 0.1)),
    });
  }
  utilization.sort((x, y) => y.pct - x.pct);
  const overallFor = (f: CreditFile, b: Bureau) => {
    const rev = f.accounts.filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a) && (a.bureaus[b]!.creditLimit ?? 0) > 0);
    const lim = rev.reduce((s, a) => s + a.bureaus[b]!.creditLimit!, 0);
    const bal = rev.reduce((s, a) => s + Math.max(0, a.bureaus[b]!.balance ?? 0), 0);
    return lim > 0 ? Math.round((bal / lim) * 100) : null;
  };
  const uBureau = BUREAUS.find((b) => overallFor(after, b) !== null) ?? null;
  const utilizationOverall = {
    bureau: uBureau,
    before: uBureau ? overallFor(before, uBureau) : null,
    after: uBureau ? overallFor(after, uBureau) : null,
  };

  // What is working in your favor (data-built bullets only).
  const positives: string[] = [];
  const afterNeg = after.accounts.filter((a) => negBureaus(a).length);
  const hasColl = afterNeg.some((a) => pv2ItemKind(a, negBureaus(a).map((x) => a.bureaus[x]!)) === "collection");
  if (!hasColl && after.publicRecordsReported !== true) positives.push(T.noCollections);
  // P0-6: a negative account (lates, derog, collection) is never named as working in the client's favor.
  const opens = after.accounts
    .filter((a) => !negBureaus(a).length)
    .map((a) => ({ a, d: BUREAUS.map((b) => parseReportDate(a.bureaus[b]?.dateOpened)).find(Boolean) }))
    .filter((x): x is { a: CreditAccount; d: Date } => !!x.d)
    .sort((x, y) => x.d.getTime() - y.d.getTime());
  if (opens.length) {
    const oldest = opens[0].a;
    // Two accounts under one creditor name (a clean card and a late one): say which card.
    const others = after.accounts.filter((x) => x !== oldest && pv2NameKey(x.creditor) === pv2NameKey(oldest.creditor));
    const tag = others.length ? pv2DistinguishingTag([oldest, ...others], T)(0) : null;
    positives.push(T.historySince(opens[0].d.getUTCFullYear(), tag && !tag.startsWith("#") ? `${oldest.creditor}, ${tag}` : oldest.creditor));
  }
  const paidLoans = after.accounts.filter(
    (a) => a.section === "installment" && !negBureaus(a).length && BUREAUS.some((b) => a.bureaus[b] && isClosedTradeline(a.bureaus[b]!, a)),
  );
  if (paidLoans.length) positives.push(T.paidLoans(paidLoans.length));
  const totalLimit = utilization.reduce((s, u) => s + u.limit, 0);
  const negativeNames = new Set(afterNeg.map((a) => a.creditor));
  const zeroLines = utilization.filter((u) => u.current === 0 && !negativeNames.has(u.account));
  if (totalLimit > 0) {
    positives.push(T.totalLimits(pv2Money(totalLimit), zeroLines.slice(0, 3).map((u) => `${u.account} (${pv2Money(u.limit)})`).join(", ")));
  }
  const openAccts = after.accounts.filter((a) => BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)));
  if (openAccts.length && openAccts.every((a) => !negBureaus(a).length)) positives.push(T.allCurrent);

  // ── Spec §6 item diff per bureau + §7 change attribution ──────────────────
  const beforeDate = parseReportDate(before.reportDate);
  const pairs = [...matches.entries()];
  const byBureau = Object.fromEntries(BUREAUS.map((b) => [b, { removed: [], added: [], changed: [] } as Pv2BureauChange])) as Record<Bureau, Pv2BureauChange>;
  const newDev = Object.fromEntries(BUREAUS.map((b) => [b, false])) as Record<Bureau, boolean>;
  const auAdded = Object.fromEntries(BUREAUS.map((b) => [b, false])) as Record<Bureau, boolean>;
  const lateFacts = new Map<string, Set<string>>();
  for (const w of wins) for (const b of w.bureaus) byBureau[b].removed.push(w.item);
  for (const a of unmatchedAfter) {
    for (const b of BUREAUS) {
      const t = a.bureaus[b];
      if (!t) continue;
      byBureau[b].added.push(a.creditor);
      if (isNegativeTradeline(t, a)) newDev[b] = true;
      if (/authorized user|\bA\.?U\.?\b/i.test(`${t.description ?? ""} ${t.remarks ?? ""} ${t.accountType ?? ""}`)) auAdded[b] = true;
    }
  }
  for (const q of newQ) {
    if (q.bureau) {
      byBureau[q.bureau].added.push(`${q.creditor} (inquiry ${q.date})`);
      newDev[q.bureau] = true;
    }
  }
  for (const [b0, a0] of pairs) {
    for (const b of BUREAUS) {
      const tb = b0.bureaus[b];
      const ta = a0.bureaus[b];
      if (!tb || !ta) continue;
      const diffFields =
        (tb.paymentStatus ?? "") !== (ta.paymentStatus ?? "") ||
        pv2Lates(tb) !== pv2Lates(ta) ||
        (tb.pastDue ?? 0) !== (ta.pastDue ?? 0) ||
        (tb.balance ?? 0) !== (ta.balance ?? 0) ||
        (tb.remarks ?? "") !== (ta.remarks ?? "");
      if (diffFields) byBureau[b].changed.push(a0.creditor);
      const priorMonths = new Set(pv2DelinquencyMonths(tb).map((m) => m.label));
      const newMonths = pv2DelinquencyMonths(ta).filter(
        // New = not on the Before pull; months more than ~2 cycles before the Before date are history, not new.
        (m) => m.level >= 2 && !priorMonths.has(m.label) && (!beforeDate || m.month.getTime() > beforeDate.getTime() - 62 * 86_400_000),
      );
      const derogNew = /charge|collection|repo/i.test(`${ta.paymentStatus ?? ""} ${ta.remarks ?? ""}`) && !/charge|collection|repo/i.test(`${tb.paymentStatus ?? ""} ${tb.remarks ?? ""}`);
      const pastDueUp = (ta.pastDue ?? 0) > (tb.pastDue ?? 0) && (ta.pastDue ?? 0) > 0;
      if (newMonths.length || pv2Lates(ta) > pv2Lates(tb) || pastDueUp || derogNew) {
        newDev[b] = true;
        const set = lateFacts.get(a0.creditor) ?? new Set<string>();
        for (const m of newMonths) set.add(m.label);
        lateFacts.set(a0.creditor, set);
      }
    }
  }
  const attribution = Object.fromEntries(
    BUREAUS.map((b) => {
      const sb0 = before.scores[b];
      const sa0 = after.scores[b];
      const delta = sb0 !== null && sa0 !== null ? sa0 - sb0 : null;
      const causes: Pv2Cause[] = [];
      if (delta !== null && Math.abs(delta) >= 5) {
        if (wins.some((w) => w.bureaus.includes(b) && w.status === "REMOVED")) causes.push("CONFIRMED_WIN");
        else if (wins.some((w) => w.bureaus.includes(b))) causes.push("PARTIAL_WIN");
        if (auAdded[b]) causes.push("AU_TRADELINE_EFFECT");
        const ub = overallFor(before, b);
        const ua = overallFor(after, b);
        if (ub !== null && ua !== null && ub - ua >= 5) causes.push("UTILIZATION_PAYDOWN");
        if (ub !== null && ua !== null && ua - ub >= 2) causes.push("UTILIZATION_INCREASE");
        if (newDev[b]) causes.push("NEW_NEGATIVE_DEVELOPMENT");
        if (!causes.length && delta > 0) causes.push("AGING_EFFECT");
        if (!causes.length) causes.push("UNVERIFIED_MOVEMENT");
      }
      return [b, { delta, causes }];
    }),
  ) as Pv2Diff["attribution"];
  // §6 client copy: causes as facts — wins first, then every new negative, then utilization.
  const movementFacts: string[] = [];
  for (const w of wins) movementFacts.push(T.factRemoved(`${w.item} (${w.bureaus.join("/")})`));
  const newFacts: string[] = [];
  for (const [creditor, months] of lateFacts) newFacts.push(T.factNewLate(creditor, [...months].sort()));
  // One classification per account (#7): verified-remains accounts are never also "new".
  const verifiedNames = informational.map((i) => i.item.replace(/ \([^)]*\)/g, "").replace(/ - [^-]+$/, ""));
  for (const a of unmatchedAfter.filter((x) => negBureaus(x).length && pv2NewSince(x, afterBase) && !verifiedNames.some((n) => pv2CreditorSimilar(n, x.creditor)))) {
    newFacts.push(T.factNewAccount(a.creditor, T.kindName(pv2ItemKind(a, negBureaus(a).map((x) => a.bureaus[x]!))), negBureaus(a).join("/")));
  }
  const newQGroups = new Map<string, { creditor: string; date: string; bureaus: Bureau[] }>();
  for (const q of newQ) {
    const k = `${qCo(q.creditor)}|${qDate(q.date)}`;
    const g = newQGroups.get(k) ?? { creditor: qName(q.creditor), date: q.date, bureaus: [] as Bureau[] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    newQGroups.set(k, g);
  }
  for (const g of newQGroups.values()) newFacts.push(T.factNewInquiry(g.creditor, g.date, g.bureaus.join("/") || "N/I"));
  movementFacts.push(...newFacts);
  const uo = { b: utilizationOverall.before, a: utilizationOverall.after };
  if (uo.b !== null && uo.a !== null && uo.a !== uo.b) movementFacts.push(T.factUtil(uo.b, uo.a));

  const now = afterDate ?? new Date();
  // File Strength age uses every account (negative or not).
  const oldestAny =
    after.accounts
      .map((a) => BUREAUS.map((b) => parseReportDate(a.bureaus[b]?.dateOpened)).find(Boolean))
      .filter((d): d is Date => !!d)
      .sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
  const severeOpen = after.accounts.filter((a) =>
    BUREAUS.some((b) => {
      const t = a.bureaus[b];
      if (!t || isClosedTradeline(t, a)) return false;
      return /\b(90|120|150|180)\b|over 120|severely/i.test(`${t.paymentStatus ?? ""} ${t.accountStatus ?? ""}`) || pv2DelinquencyMonths(t).some((m) => m.level >= 4 && now.getTime() - m.month.getTime() <= 92 * 86_400_000);
    }),
  );
  const lateWhen = (a: CreditAccount) =>
    BUREAUS.flatMap((b) => (a.bureaus[b]?.gridMarks ?? []).map((m) => parseReportDate(m.split(":")[0]))).filter((d): d is Date => !!d);
  const lateDates = afterNeg.flatMap(lateWhen);
  const recentCut = now.getTime() - 730 * 86_400_000;
  const anyLates = afterNeg.some((a) => negBureaus(a).some((b) => pv2Lates(a.bureaus[b]) > 0 || /late/i.test(a.bureaus[b]!.paymentStatus || "")));
  return {
    beforeDate: before.reportDate,
    afterDate: after.reportDate,
    wins,
    clientActions,
    targets,
    utilization,
    utilizationOverall,
    utilizationNotes: [...new Set(utilizationNotes)],
    positives: positives.slice(0, 5),
    positivesFlags: { history: opens.length > 0, noCollections: !hasColl && after.publicRecordsReported !== true },
    positiveAccountKeys: opens.length ? [pv2AccountKey(opens[0].a)] : [],
    targetAccountKeys: targets.flatMap((t) => (targetSources.has(t) ? [pv2AccountKey(targetSources.get(t)!)] : [])),
    internal,
    informational,
    byBureau,
    attribution,
    movementFacts,
    newNegativeFacts: newFacts,
    projectionLift: (() => {
      // P0-5: reuse v2.1 §6 (per-event ranges, round caps, +100 cumulative per bureau).
      const last = analysis.projections[analysis.projections.length - 1];
      return Object.fromEntries(
        BUREAUS.map((b) => {
          const cur = after.scores[b];
          const r = last?.ranges?.[b];
          return [b, cur !== null && r ? [Math.max(0, r[0] - cur), Math.min(100, Math.max(0, r[1] - cur))] : [0, 0]];
        }),
      ) as Record<Bureau, [number, number]>;
    })(),
    counts: {
      beforeAccounts: before.accounts.length,
      afterAccounts: after.accounts.length,
      beforeInquiries: before.inquiries.length,
      afterInquiries: after.inquiries.length,
    },
    after: {
      openDerogatory: afterNeg.filter((a) => {
        const k = pv2ItemKind(a, negBureaus(a).map((x) => a.bureaus[x]!));
        return (k === "charge_off" || k === "collection") && BUREAUS.some((b) => a.bureaus[b] && !/paid|settled/i.test(a.bureaus[b]!.accountStatus || ""));
      }).length,
      derogatory: afterNeg.length,
      lates24m: lateDates.some((d) => d.getTime() >= recentCut) || (anyLates && !lateDates.length),
      olderLates: lateDates.some((d) => d.getTime() < recentCut),
      publicRecord: after.publicRecordsReported === true,
      openRevolving: utilization.length,
      activeSevereDelinquency: severeOpen.length > 0,
      severeOpenAccounts: severeOpen.length,
      oldestYears: oldestAny ? Math.max(0, (now.getTime() - oldestAny.getTime()) / (365.25 * 86_400_000)) : null,
      hasRevolving: openAccts.some((a) => a.section === "revolving"),
      hasInstallment: after.accounts.some((a) => a.section === "installment" || a.section === "mortgage"),
    },
  };
}

// ── formulas ────────────────────────────────────────────────────────────────

export function pv2MiddleScore(s: Record<Bureau, number | null>): number | null {
  const v = BUREAUS.map((b) => s[b]).filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length === 3 ? v[1] : v.length === 2 ? Math.round((v[0] + v[1]) / 2) : v[0];
}

/** "[=========== ]" 20 chars, ASCII only. */
export function pv2AsciiBar(score: number | null): string {
  if (score === null) return `[${" ".repeat(20)}]`;
  const n = Math.max(0, Math.min(20, Math.round(((score - 300) / 550) * 20)));
  return `[${"=".repeat(n)}${" ".repeat(20 - n)}]`;
}

export interface Pv2FileStrength {
  total: number;
  /** Payment history 0-35 (active 90+ delinquency caps at 10). */
  paymentHistory: number;
  /** Utilization 0-30 (over 75% caps at 5). */
  utilization: number;
  /** Negative items 0-20. */
  negatives: number;
  /** Age + mix 0-15. */
  ageMix: number;
}

/**
 * File Strength from components (Progress Report Engine Spec v1, PR-P0-7):
 * payment history 35, utilization 30, negative items 20, age + mix 15.
 * Unknown utilization never adds points.
 */
export function pv2FileStrengthParts(o: {
  lates24m: boolean;
  olderLates: boolean;
  activeSevereDelinquency: boolean;
  overallUtil: number | null;
  openChargeOffsOrCollections: number;
  otherNegatives: number;
  publicRecord: boolean;
  oldestYears: number | null;
  hasRevolving: boolean;
  hasInstallment: boolean;
  openRevolving: number;
}): Pv2FileStrength {
  let paymentHistory = 35 - (o.lates24m ? 15 : o.olderLates ? 7 : 0);
  if (o.activeSevereDelinquency) paymentHistory = Math.min(paymentHistory, 10);
  const u = o.overallUtil;
  let utilization = u === null ? 10 : u < 10 ? 30 : u < 30 ? 25 : u < 50 ? 15 : u <= 75 ? 10 : 5;
  if (u !== null && u > 75) utilization = Math.min(utilization, 5);
  const negatives = Math.max(0, 20 - o.openChargeOffsOrCollections * 6 - o.otherNegatives * 3 - (o.publicRecord ? 10 : 0));
  const age = o.oldestYears === null ? 1 : o.oldestYears >= 10 ? 7 : o.oldestYears >= 5 ? 5 : o.oldestYears >= 2 ? 3 : 1;
  const mix = o.hasRevolving && o.hasInstallment ? 5 : o.hasRevolving || o.hasInstallment ? 3 : 0;
  const ageMix = Math.min(15, age + mix + (o.openRevolving >= 3 ? 3 : 0));
  const parts = { paymentHistory: Math.max(0, paymentHistory), utilization, negatives, ageMix };
  return { ...parts, total: Math.max(0, Math.min(100, parts.paymentHistory + parts.utilization + parts.negatives + parts.ageMix)) };
}

/** Projected goal RANGE (never one number; always > current; max 850). */
export function pv2GoalRange(current: number, remainingLift: number, overallUtil: number | null): { low: number; high: number } {
  const [uLow, uHigh] = overallUtil === null ? [0, 0] : overallUtil > 50 ? [15, 25] : overallUtil >= 30 ? [8, 15] : [0, 5];
  const low = Math.min(850, current + Math.max(5, Math.round(remainingLift * 0.35) + uLow));
  const high = Math.min(850, Math.max(low + 10, current + Math.round(remainingLift * 0.6) + uHigh));
  return { low: Math.min(low, 849), high: Math.max(Math.min(high, 850), Math.min(low, 849) + 1) };
}

// ── validation layer ────────────────────────────────────────────────────────

export interface Pv2Flag {
  code:
    | "parse_failure"
    | "same_pull"
    | "chronology_swapped"
    | "unverified_movement"
    | "round_mismatch"
    | "file_strength_cap"
    | "goal_not_above_current"
    | "pay_to_order"
    | "no_negatives_contradiction"
    | "text_hygiene"
    | "file_strength_review"
    | "scores_suspicious"
    | "internal_note";
  message: string;
}

const UI_LABEL_JUNK = /current address|order an update now|currently using across|previous addresses|consumer statement/i;

export function pv2Validate(input: {
  diff: Pv2Diff | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  scoresBefore: Record<Bureau, number | null>;
  scoresAfter: Record<Bureau, number | null>;
  clientText: string[];
  fileStrength: number;
  goal: { low: number; high: number } | null;
  utilization: Array<{ payTo30: number; payTo10: number }>;
}): Pv2Flag[] {
  const flags: Pv2Flag[] = [];
  const d = input.diff;
  if (!d) {
    flags.push({ code: "parse_failure", message: "Account-level read not available for both pulls — wins/targets come from text parsing; verify against the PDFs." });
  } else {
    if (!d.counts.beforeAccounts || !d.counts.afterAccounts) {
      flags.push({ code: "parse_failure", message: `Parse failure: ${d.counts.beforeAccounts} accounts BEFORE / ${d.counts.afterAccounts} AFTER.` });
    }
    if (d.beforeDate && d.beforeDate === d.afterDate) flags.push({ code: "same_pull", message: `BEFORE and AFTER have the same report date (${d.afterDate}).` });
    const bd = parseReportDate(d.beforeDate);
    const ad = parseReportDate(d.afterDate);
    if (bd && ad && bd.getTime() > ad.getTime()) flags.push({ code: "chronology_swapped", message: "BEFORE is newer than AFTER — swapped." });
    for (const n of d.internal) flags.push({ code: "internal_note", message: n });
    // Spec §7: a bureau move of 5+ with no attributed cause gates delivery.
    const unverified = BUREAUS.filter((b) => d.attribution?.[b]?.causes.includes("UNVERIFIED_MOVEMENT"));
    if (unverified.length) {
      flags.push({
        code: "unverified_movement",
        message: `Unverified score movement on ${unverified.map((b) => `${b} ${d.attribution[b].delta! > 0 ? "+" : ""}${d.attribution[b].delta}`).join(", ")} — no removal, utilization or new-negative cause found; verify before delivery.`,
      });
    }
    if (d.targets.length && input.clientText.some((t) => /no negatives|no negative items|none detected/i.test(t))) {
      flags.push({ code: "no_negatives_contradiction", message: "Text says no negatives while the AFTER pull has negative accounts." });
    }
  }
  if (input.beforeHash && input.beforeHash === input.afterHash) flags.push({ code: "same_pull", message: "BEFORE and AFTER are the same file." });
  // With targets left, the capped projection must move; with none left the goal is the current score.
  if (input.goal && (d?.targets.length ?? 0) > 0 && input.goal.high <= (pv2MiddleScore(input.scoresAfter) ?? 0)) flags.push({ code: "goal_not_above_current", message: "Projected goal is not above the current middle score." });
  if (input.utilization.some((u) => u.payTo10 > u.payTo30)) flags.push({ code: "pay_to_order", message: "Pay to 10% target is above the 30% target." });
  if (input.clientText.some((t) => UI_LABEL_JUNK.test(t) || pv2IsJunkItem(t.split(" - ")[0]))) flags.push({ code: "text_hygiene", message: "Report-UI / template labels found in client text." });
  // PR-P0-7 sanity: a strong File Strength on a weak file needs a human look.
  const middleAfter = pv2MiddleScore(input.scoresAfter);
  if (input.fileStrength > 60 && middleAfter !== null && middleAfter < 550) {
    flags.push({ code: "file_strength_review", message: `File Strength ${input.fileStrength} with a middle score of ${middleAfter} — review the components.` });
  }
  // PR-P1-2: scores_suspicious.
  const suspicious: string[] = [];
  for (const b of BUREAUS) {
    for (const v of [input.scoresBefore[b], input.scoresAfter[b]]) if (v !== null && (v < 300 || v > 850)) suspicious.push(`${b} score ${v} outside 300-850`);
    const att = d?.attribution?.[b];
    if (att?.delta !== null && att?.delta !== undefined && Math.abs(att.delta) >= 10 && att.causes.includes("UNVERIFIED_MOVEMENT")) suspicious.push(`${b} moved ${att.delta} with no attributed cause`);
  }
  if (BUREAUS.every((b) => input.scoresBefore[b] !== null && input.scoresBefore[b] === input.scoresAfter[b]) && d?.beforeDate === d?.afterDate) {
    suspicious.push("Before and After pulls are identical");
  }
  if (suspicious.length) flags.push({ code: "scores_suspicious", message: `Scores suspicious: ${suspicious.join("; ")}.` });
  return flags;
}

/** Standard CROA disclosure (same text as every OFG client document). */
export const PV2_CROA = {
  en: "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq. We do not guarantee specific score improvements. Results vary by individual.",
  es: "Optimum Financial Group proporciona servicios de reparación de crédito en cumplimiento con la Ley de Organizaciones de Reparación de Crédito (CROA), 15 U.S.C. §1679 et seq. No garantizamos mejoras específicas en el puntaje. Los resultados varían según el individuo.",
} as const;

/** PDF + plan labels (EN / ES). Spanish version is approved by the ES owner. */
function pv2L(lang: Pv2Lang) {
  const es = lang === "es";
  return {
    brand: "OPTIMUM FINANCIAL GROUP",
    /** A bureau with no score on that report; the middle score stays "--". */
    noScore: es ? "Sin puntaje" : "No score",
    title: es ? "INFORME DE PROGRESO DE CREDITO" : "CREDIT PROGRESS REPORT",
    preparedFor: (n: string, b: string, c: string) => (es ? `Preparado para: ${n}  |  Base ${b}  |  Actual ${c}` : `Prepared for: ${n}  |  Baseline ${b}  |  Current ${c}`),
    page: (n: number) => (es ? `Pagina ${n} de 3` : `Page ${n} of 3`),
    scoreProgress: es ? "Su progreso de puntaje" : "Your Score Progress",
    intro: (first: string, base: string, allUp: boolean, scoreText: string) =>
      es
        ? `${first}, asi esta su archivo desde su base del ${base}. ${allUp ? "Todos los buros subieron, y su" : "Su"} puntaje medio ${scoreText}.`
        : `${first}, here is where your file stands since your ${base} baseline. ${allUp ? "Every bureau moved up, and your" : "Your"} middle score ${scoreText}.`,
    climbed: (b: number, a: number) => (es ? `subio de ${b} a ${a}` : `climbed from ${b} to ${a}`),
    isNow: (a: number, b: number) => (es ? `es ${a} (base ${b})` : `is ${a} (baseline ${b})`),
    shownBelow: es ? "se muestra abajo" : "is shown below",
    bureau: es ? "Buro" : "Bureau",
    baseline: (d: string) => (es ? `Base (${d})` : `Baseline (${d})`),
    current: (d: string) => (es ? `Actual (${d})` : `Current (${d})`),
    gained: es ? "Puntos ganados" : "Points Gained",
    middle: es ? "Puntaje medio" : "Middle Score",
    pts: "pts",
    cameOff: es ? "Lo que salio de su reporte" : "What Came Off Your Report",
    itemRemoved: es ? "Elemento eliminado" : "Item Removed",
    bureaus: es ? "Buros" : "Bureaus",
    impact: es ? "Impacto" : "Impact",
    status: es ? "Estado" : "Status",
    impactText: (imp: string, kind: string, partialN: number) =>
      `${es ? ({ HIGH: "ALTO", MEDIUM: "MEDIO", LOW: "BAJO" } as Record<string, string>)[imp] : imp} - ${
        kind === "inquiry"
          ? es ? "consultas eliminadas" : "inquiries deleted"
          : partialN
            ? es ? `corregido en ${partialN} ${partialN === 1 ? "buro" : "buros"}` : `corrected on ${partialN} ${partialN === 1 ? "bureau" : "bureaus"}`
            : kind === "history"
              ? es ? "historial de atrasos corregido" : "late history corrected"
              : es ? "cuenta negativa eliminada" : "negative account removed"
      }`,
    removed: es ? "ELIMINADO" : "REMOVED",
    partial: (remains: string) => (es ? `GANANCIA PARCIAL (queda en ${remains})` : `PARTIAL WIN (${remains} remains)`),
    progressToo: es ? "Su progreso tambien" : "Your progress too",
    progressTooBody: (items: string) =>
      es
        ? `${items}. Estas fueron acciones suyas, no disputas, y son parte de este cambio de puntaje.`
        : `${items}. These were your actions, not disputes, and they are part of this score change.`,
    stillOn: (r: number) => (es ? `Lo que sigue en su reporte (objetivos de la Ronda ${r})` : `What Is Still On Your Report (Round ${r} Targets)`),
    stillOnCont: (r: number) => (es ? `Objetivos de la Ronda ${r} (continuacion)` : `Round ${r} Targets (continued)`),
    inquirySummary: (n: number, per: string) =>
      es ? `Consultas de credito: ${n} (${per}) - tambien en disputa` : `Hard inquiries: ${n} (${per}) - also being disputed`,
    progressNone: es
      ? "Mantener todas las cuentas al dia mientras seguimos con las disputas tambien suma a su puntaje."
      : "Keeping every account current while we work the disputes adds to your score too.",
    missingBureau: (names: string) =>
      es
        ? `${names}: sin puntaje en el reporte base, por eso no se compara ese buro ni el puntaje medio.`
        : `${names}: no score on the baseline report, so that bureau and the middle score are not compared.`,
    planNoCards: es
      ? "Su parte: mantenga cada pago a tiempo y evite nuevas solicitudes de credito."
      : "Your part: keep every payment on time and avoid new credit applications.",
    planOfgWithInquiries: (n: number) => (es ? `, ademas de ${n} ${n === 1 ? "consulta" : "consultas"} de credito` : `, plus ${n} hard ${n === 1 ? "inquiry" : "inquiries"}`),
    roundCol: es ? "Ronda" : "Round",
    sinceStart: (d: string, b: number, a: number) =>
      es
        ? `Desde que empezo${d ? ` (${d})` : ""}: puntaje medio ${b} -> ${a} (${a - b >= 0 ? "+" : ""}${a - b} pts).`
        : `Since you started${d ? ` (${d})` : ""}: middle score ${b} -> ${a} (${a - b >= 0 ? "+" : ""}${a - b} pts).`,
    whatMoved: es ? "Lo que movio su puntaje" : "What Moved Your Score",
    verifiedTitle: es ? "Verificado por el buro (informativo)" : "Verified by the Bureau (Informational)",
    verifiedBody: es
      ? "El buro verifico estos elementos. Quedan como informativos hasta tener nueva evidencia para disputarlos."
      : "The bureau verified these items. They stay informational until we have new evidence to dispute them.",
    item: es ? "Elemento" : "Item",
    detail: es ? "Detalle" : "Detail",
    priority: es ? "Prioridad" : "Priority",
    prio: (p: string) => (es ? ({ HIGH: "ALTA", MEDIUM: "MEDIA", LOW: "BAJA" } as Record<string, string>)[p] ?? p : p),
    groupRow: (r: number, n: number, what: string) => (es ? `${r ? `Ronda ${r}` : "Sin ronda"}: ${n} ${what}` : `${r ? `Round ${r}` : "No round"}: ${n} ${what}`),
    inquiriesWord: (n: number) => (es ? (n === 1 ? "consulta" : "consultas") : n === 1 ? "inquiry" : "inquiries"),
    accountsWord: (n: number) => (es ? (n === 1 ? "cuenta" : "cuentas") : n === 1 ? "account" : "accounts"),
    cameOffThisRound: es ? "Lo que salio de su reporte esta ronda" : "What Came Off Your Report This Round",
    cameOffSinceStart: es ? "Lo que salio de su reporte desde que empezo" : "What Came Off Your Report Since You Started",
    sinceStartWins: (n: number, items: string) =>
      es ? `Desde que empezo: ${n} ${n === 1 ? "elemento eliminado o corregido" : "elementos eliminados o corregidos"} (${items}).` : `Since you started: ${n} ${n === 1 ? "item" : "items"} removed or corrected (${items}).`,
    activeRow: (dr: number, items: string) => (es ? `Disputas de Ronda ${dr}: ${items}` : `Round ${dr} disputes: ${items}`),
    noTargets: es ? "No quedan cuentas negativas en el reporte actual." : "No negative accounts remain on the current pull.",
    utilTitle: es ? "Utilizacion de credito" : "Credit Utilization",
    utilIntro: (b: number | null, a: number | null, bureau: string) =>
      `${es ? "La utilizacion es cuanto usa de sus limites de credito. Menos de 30% es bueno; menos de 10% da el mayor beneficio." : "Utilization is how much of your credit limits you are using. Under 30% is good; under 10% gives the maximum boost."}${
        b !== null && a !== null
          ? es
            ? ` Su utilizacion total ${a <= b ? "mejoro" : "cambio"} de ${b}% a ${a}% (${bureau}).`
            : ` Your overall utilization ${a <= b ? "improved" : "moved"} from ${b}% to ${a}% (${bureau}).`
          : ""
      }`,
    account: es ? "Cuenta" : "Account",
    limit: es ? "Limite" : "Limit",
    baseBal: es ? "Saldo base" : "Baseline Bal.",
    curBal: es ? "Saldo actual" : "Current Bal.",
    used: es ? "% usado" : "% Used",
    payTo30h: es ? "Abonar para 30%" : "Pay down to 30%",
    payTo10h: es ? "Abonar para 10%" : "Pay down to 10%",
    band: (p: number) => (p > 50 ? (es ? "ALTO" : "HIGH") : p >= 30 ? (es ? "REGULAR" : "FAIR") : es ? "BIEN" : "GOOD"),
    payTo: (m: string) => (es ? `Pagar a ${m}` : `Pay to ${m}`),
    alreadyOk: es ? "Ya esta bien" : "Already OK",
    totalRevolving: (b: string) => (es ? `Total revolvente${b ? ` (${b})` : ""}` : `Total revolving${b ? ` (${b})` : ""}`),
    noUtil: es ? "No hay cuentas revolventes abiertas con limite en el reporte actual." : "No open revolving accounts with a credit limit on the current pull.",
    working: es ? "Lo que trabaja a su favor" : "What Is Working in Your Favor",
    actionNeeded: es ? "Accion necesaria" : "Action Needed",
    roadmap: es ? "Su ruta" : "Your Roadmap",
    roundsDone: (r: number) => (r > 1 ? (es ? `RONDAS 1-${r - 1} COMPLETAS` : `ROUNDS 1-${r - 1} COMPLETE`) : es ? "INSCRIPCION COMPLETA" : "ENROLLMENT COMPLETE"),
    removedCount: (n: number) => (n ? (es ? `${n} ${n === 1 ? "elemento eliminado o corregido" : "elementos eliminados o corregidos"}` : `${n} ${n === 1 ? "item" : "items"} removed or corrected`) : es ? "Base establecida" : "Baseline set"),
    roundActive: (r: number) => (es ? `RONDA ${r} ACTIVA` : `ROUND ${r} ACTIVE`),
    nextTargets: es ? "Siguientes objetivos" : "Next targets",
    utilization: es ? "UTILIZACION" : "UTILIZATION",
    bringUnder: (names: string) => (es ? `Bajar ${names} a < 30%` : `Bring ${names} < 30%`),
    keepUnder: es ? "Mantener saldos bajo 30%" : "Keep balances under 30%",
    scoreGoal: es ? "META DE PUNTAJE" : "SCORE GOAL",
    projected: (l: number, h: number) => (es ? `${l}-${h} proyectado` : `${l}-${h} projected`),
    done: es ? "HECHO" : "DONE",
    inProgress: es ? "EN PROCESO" : "IN PROGRESS",
    clientAction: es ? "ACCION DEL CLIENTE" : "CLIENT ACTION",
    target: es ? "META" : "TARGET",
    currentRow: es ? "Actual" : "Current",
    goalRow: es ? "Meta proyectada" : "Projected goal",
    goalVal: (l: number, h: number) => (es ? `${l}-${h} (proyectado)` : `${l}-${h} (projected)`),
    gapRow: es ? "Diferencia restante" : "Gap remaining",
    points: es ? "puntos" : "points",
    plan: es ? "Su plan de accion personalizado" : "Your Personalized Action Plan",
    step: (n: number) => (es ? `Paso ${n}` : `Step ${n}`),
    strength: es ? "Fortaleza del archivo" : "File Strength Score",
    strengthBar: es ? "FORTALEZA" : "FILE STRENGTH",
    questions: (ph: string, site: string) => (es ? `Preguntas? Llamenos al ${ph} o visite ${site}.` : `Questions? Call us at ${ph} or visit ${site}.`),
    croaTitle: es ? "DIVULGACION CROA" : "CROA DISCLOSURE",
    // P2-2: the standard CROA disclosure verbatim (with its citation) + the projection note.
    croa: es ? `${PV2_CROA.es} Los puntajes proyectados son estimaciones, no garantias.` : `${PV2_CROA.en} Projected scores are estimates, not guarantees.`,
    // P1-6: facts only — state utilization %, never rank score impact; no timing language.
    actionUtil: (top: string, pct: number, cur: string, lim: string, more: string) =>
      es
        ? `${top} esta al ${pct}% de su limite (${cur} de ${lim})${more ? `; tambien ${more}` : ""}. Bajar cada tarjeta a menos de 30% (menos de 10% es mejor) reduce su utilizacion.`
        : `${top} is at ${pct}% of its limit (${cur} of ${lim})${more ? `; also ${more}` : ""}. Bringing each card under 30% (under 10% is best) lowers your utilization.`,
    keepCurrent: es ? "Mantenga todas las cuentas al corriente: un nuevo atraso podria deshacer este progreso." : "Keep every account current - one new late payment could undo this progress.",
    planOfg: (r: number, names: string) => (es ? `Nuestro equipo (Ronda ${r}): estamos disputando ${names || "los elementos restantes de su archivo"}.` : `Our team (Round ${r}): we are actively disputing ${names || "the remaining items on your file"}.`),
    planClient: (names: string) =>
      names
        ? es ? `Su parte (utilizacion): baje ${names}, buscando menos de 30% en cada tarjeta.` : `Your part (utilization): lower ${names}, aiming for under 30% on each card.`
        : es ? "Su parte: mantenga los saldos de tarjetas bajo 30% (bajo 10% es mejor)." : "Your part: keep card balances under 30% (under 10% is best).",
    planProtect: (r: number) => (es ? `Proteja sus logros: mantenga todo al corriente y evite nuevas solicitudes de credito mientras la Ronda ${r} esta en proceso.` : `Protect your gains: keep every account current and avoid new credit applications while Round ${r} is in progress.`),
    planTimeline: (r: number) =>
      es
        ? `Ronda ${r}: revisamos cada respuesta de los buros cuando llega y la reportamos en su siguiente informe.`
        : `Round ${r}: we review each bureau response as it arrives and report it in your next progress report.`,
    planNext: (r: number) => (es ? `Proxima revision: sacaremos un reporte nuevo de 3 buros al cerrar la Ronda ${r} y le enviaremos su siguiente informe.` : `Next check-in: we will pull a fresh 3-bureau report when Round ${r} closes and send your next progress report.`),
    then: es ? ", luego " : ", then ",
    strengthNote: (strengths: string, growth: string) =>
      `${strengths ? (es ? `Su archivo tiene una base solida: ${strengths}. ` : `Your file has a solid foundation: ${strengths}. `) : ""}${
        growth ? (es ? `El espacio restante para crecer esta en ${growth}.` : `The remaining room to grow is in ${growth}.`) : es ? "Mantenga saldos bajos y pagos a tiempo para seguir creciendo." : "Keep balances low and payments on time to build on it."
      }`,
    sHistory: es ? "historial de credito" : "credit history",
    sNoColl: es ? "sin cobranzas ni registros publicos" : "no collections or public records",
    sLimits: es ? "limites altos" : "high limits",
    gUtil: es ? "la utilizacion revolvente" : "revolving utilization",
  };
}

// ── PDF (exactly 3 pages, letter) ───────────────────────────────────────────

export interface Pv2PdfData {
  lang: Pv2Lang;
  /** Round 1 starting point: no earlier report exists, so nothing is compared yet. */
  startingPoint?: boolean;
  /**
   * No account-level data for this pull: wins / targets sections print
   * nothing client-facing (never "none detected"); delivery is flagged.
   */
  parseFailure?: boolean;
  clientFirstName: string;
  clientName: string;
  baselineDate: string;
  currentDate: string;
  round: number;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  wins: Pv2Win[];
  clientActions: string[];
  targets: Pv2Target[];
  utilization: Pv2UtilRow[];
  utilizationOverall: { before: number | null; after: number | null; bureau: Bureau | null };
  utilizationNotes: string[];
  positives: string[];
  actionNeeded: string[];
  goal: { low: number; high: number };
  fileStrength: number;
  /** Component breakdown (PR-P0-7); persisted with the round. */
  fileStrengthParts?: Pv2FileStrength;
  fileStrengthNote: string;
  plan: string[];
  phone: string;
  site: string;
  /** Office address printed in the footer. */
  address?: string;
  /** PR-P1-1: scores at enrollment for the "since you started" line. */
  sinceStart?: { date: string; scores: Record<Bureau, number | null> } | null;
  /** PR-P0-6: facts behind the score movement (client copy). */
  movementFacts?: string[];
  /** PR-P1-4: verified disputes, informational until new evidence. */
  informational?: Array<{ item: string; bureaus: Bureau[]; detail: string }>;
  /** v1.1 P1-2: what the wins table compares — prior round After ("this_round") or the enrollment baseline ("since_start"). */
  winsScope?: "this_round" | "since_start";
  /** v1.1 P1-2: baseline → this After wins, shown as "Since you started" when the table is this round. */
  winsSinceStart?: Pv2Win[] | null;
  /** v1.1 P1-1: case program round now active (after this report). */
  programRound?: number;
  /** v1.1 P1-1: the dispute round now being worked and its items (roadmap = Step 1). */
  activeSet?: { disputeRound: number; items: string[] } | null;
  /** v1.1 P0-5: per-bureau projected range (caps: +100 per bureau, 760). */
  goalByBureau?: Record<Bureau, [number, number] | null>;
}

/** What the renderer actually printed (Section 9 self-check). */
export interface Pv2RenderStats {
  targetsRepresented: number;
  winsRepresented: number;
  pages: number;
  croaText: string;
  clientText: string[];
}

/**
 * P0-3: every target is rendered. When the rows do not fit, inquiries collapse
 * into one row per round, then accounts collapse per round — names listed in
 * full (never dropped, never "..."). Returns rows + how many items they carry.
 */
export function pv2TargetRows(
  targets: Pv2Target[],
  maxRows: number,
  lang: Pv2Lang,
): { rows: string[][]; represented: number } {
  const L = pv2L(lang);
  const full = (t: Pv2Target) => [t.item, t.bureaus.join(" / ") || "N/I", t.detail || "--", L.prio(t.priority)];
  if (targets.length <= maxRows) return { rows: targets.map(full), represented: targets.length };
  const group = (list: Pv2Target[], label: (n: number) => string): string[][] => {
    const byRound = new Map<number, Pv2Target[]>();
    for (const t of list) byRound.set(t.round ?? 0, [...(byRound.get(t.round ?? 0) ?? []), t]);
    return [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .map(([r, ts]) => [
        L.groupRow(r, ts.length, label(ts.length)),
        [...new Set(ts.flatMap((t) => t.bureaus))].join(" / ") || "N/I",
        ts.map((t) => t.item.replace(/ - [^-]+$/, "")).join("; "),
        L.prio(ts.some((t) => t.priority === "HIGH") ? "HIGH" : ts.some((t) => t.priority === "MEDIUM") ? "MEDIUM" : "LOW"),
      ]);
  };
  const inq = targets.filter((t) => t.kind === "inquiry");
  const acc = targets.filter((t) => t.kind !== "inquiry");
  const step1 = [...acc.map(full), ...group(inq, L.inquiriesWord)];
  if (step1.length <= maxRows) return { rows: step1, represented: targets.length };
  return { rows: [...group(acc, L.accountsWord), ...group(inq, L.inquiriesWord)], represented: targets.length };
}

const PV2 = {
  navy: rgb(0.051, 0.122, 0.235),
  gold: rgb(0.788, 0.659, 0.298),
  text: rgb(0.16, 0.18, 0.22),
  muted: rgb(0.42, 0.45, 0.5),
  light: rgb(0.965, 0.97, 0.978),
  white: rgb(1, 1, 1),
  green: rgb(0.09, 0.55, 0.3),
  goldTint: rgb(0.99, 0.97, 0.9),
};

const BUREAU_FULL: Record<Bureau, string> = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };

function pv2Safe(s: string): string {
  return String(s ?? "")
    .replace(/[–—―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•·]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

class Pv2Page {
  y: number;
  readonly M = 40;
  readonly W = 612;
  readonly CW = 612 - 80;
  constructor(
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
  ) {
    this.y = 792 - 104;
  }
  text(s: string, x: number, y: number, size: number, f: PDFFont = this.font, color = PV2.text, maxW?: number) {
    let t = pv2Safe(s);
    if (maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + ".";
    this.page.drawText(t, { x, y, size, font: f, color });
  }
  wrap(s: string, size: number, maxW: number, f: PDFFont = this.font): string[] {
    const out: string[] = [];
    let cur = "";
    for (const w of pv2Safe(s).split(" ").filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  }
  heading(s: string) {
    this.y -= 4;
    this.text(s, this.M, this.y, 13, this.bold, PV2.navy);
    this.page.drawRectangle({ x: this.M, y: this.y - 6, width: 46, height: 2, color: PV2.gold });
    this.y -= 22;
  }
  para(s: string, size = 9, color = PV2.text, f: PDFFont = this.font) {
    for (const l of this.wrap(s, size, this.CW, f)) {
      this.text(l, this.M, this.y, size, f, color);
      this.y -= size + 3.5;
    }
    this.y -= 4;
  }
  table(headers: string[], rows: string[][], widths: number[], size = 8, boldLast = false) {
    const colW = widths.map((w) => w * this.CW);
    this.page.drawRectangle({ x: this.M, y: this.y - 5, width: this.CW, height: 16, color: PV2.navy });
    let x = this.M + 4;
    headers.forEach((h, i) => {
      this.text(h, x, this.y, size, this.bold, PV2.white, colW[i] - 6);
      x += colW[i];
    });
    this.y -= 16;
    rows.forEach((row, ri) => {
      const cells = row.map((c, i) => this.wrap(c, size, colW[i] - 8));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 3) + 6;
      if (ri % 2 === 1) this.page.drawRectangle({ x: this.M, y: this.y - h + size + 1, width: this.CW, height: h, color: PV2.light });
      let xx = this.M + 4;
      cells.forEach((lines, i) => {
        let yy = this.y;
        for (const l of lines) {
          this.text(l, xx, yy, size, boldLast && ri === rows.length - 1 ? this.bold : this.font);
          yy -= size + 3;
        }
        xx += colW[i];
      });
      this.y -= h;
    });
    this.y -= 8;
  }
  callout(title: string, body: string) {
    const lines = this.wrap(body, 8.8, this.CW - 20);
    const h = 22 + lines.length * 12;
    const top = this.y + 8;
    this.page.drawRectangle({ x: this.M, y: top - h, width: this.CW, height: h, color: PV2.goldTint, borderColor: PV2.gold, borderWidth: 0.8 });
    this.text(title, this.M + 10, top - 14, 9, this.bold, PV2.navy);
    let yy = top - 27;
    for (const l of lines) {
      this.text(l, this.M + 10, yy, 8.8);
      yy -= 12;
    }
    this.y = top - h - 10;
  }
}

/** Rows that fit the remaining page height (keeps the report at 3 pages). */
function pv2Fit<T>(rows: T[], perRow: number, room: number): T[] {
  return rows.slice(0, Math.max(1, Math.floor(room / perRow)));
}

export async function generateProgressReportV2Pdf(d: Pv2PdfData, logoPng?: Uint8Array | null, stats?: Pv2RenderStats): Promise<Buffer> {
  const L = pv2L(d.lang);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await pdf.embedPng(logoPng);
    } catch {
      logo = null;
    }
  }
  const pages: Pv2Page[] = [1, 2, 3].map((n) => {
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 792 - 76, width: 612, height: 76, color: PV2.navy });
    page.drawRectangle({ x: 0, y: 792 - 79, width: 612, height: 3, color: PV2.gold });
    let tx = 40;
    if (logo) {
      const h = 38;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: 40, y: 792 - 76 + 19, width: w, height: h });
      tx = 40 + w + 14;
    }
    const p = new Pv2Page(page, font, bold, mono);
    p.text(L.brand, tx, 792 - 28, 9, bold, PV2.gold);
    p.text(L.title, tx, 792 - 44, 13, bold, PV2.white);
    p.text(L.preparedFor(d.clientName, d.baselineDate, d.currentDate), tx, 792 - 60, 8.5, font, rgb(0.85, 0.87, 0.92));
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 36, color: PV2.light });
    p.text(`Optimum Financial Group  |  ${d.phone}  |  ${d.site}${d.address ? `  |  ${d.address}` : ""}`, 40, 15, 7.5, font, PV2.muted);
    p.text(L.page(n), 612 - 40 - font.widthOfTextAtSize(L.page(n), 7.5), 15, 7.5, font, PV2.muted);
    return p;
  });

  // #5: a middle score needs all three bureaus — never a 2-bureau "middle".
  const mid = (k: "before" | "after") => (BUREAUS.every((b) => d.scores[b][k] !== null) ? pv2MiddleScore({ TU: d.scores.TU[k], EX: d.scores.EX[k], EQ: d.scores.EQ[k] }) : null);
  const mb = mid("before");
  const ma = mid("after");

  // ── Page 1: score progress + wins + targets ───────────────────────────────
  const p1 = pages[0];
  p1.heading(L.scoreProgress);
  const moved = BUREAUS.filter((b) => d.scores[b].before !== null && d.scores[b].after !== null);
  // "Every bureau moved up" only when all three are on both reports and all rose (#5).
  const allUp = moved.length === 3 && moved.every((b) => d.scores[b].after! > d.scores[b].before!);
  p1.para(
    d.startingPoint
      ? d.lang === "es"
        ? `${d.clientFirstName}, este es su punto de partida al ${d.currentDate}. Aun no hay cambios que comparar: sus proximos informes mostraran el progreso desde esta fecha.`
        : `${d.clientFirstName}, this is your starting point as of ${d.currentDate}. There are no changes to compare yet: your next reports will show your progress from this date.`
      : L.intro(d.clientFirstName, d.baselineDate, allUp, mb !== null && ma !== null ? (ma >= mb ? L.climbed(mb, ma) : L.isNow(ma, mb)) : L.shownBelow),
  );
  const missing = BUREAUS.filter((b) => d.scores[b].before === null && d.scores[b].after !== null);
  if (missing.length) p1.para(L.missingBureau(missing.map((b) => BUREAU_FULL[b]).join(", ")), 8, PV2.muted);
  const delta = (b: number | null, a: number | null) => (b === null || a === null ? "--" : `${a - b >= 0 ? "+" : ""}${a - b}`);
  p1.table(
    [L.bureau, L.baseline(d.baselineDate), L.current(d.currentDate), L.gained],
    [
      ...BUREAUS.map((b) => [BUREAU_FULL[b], String(d.scores[b].before ?? L.noScore), String(d.scores[b].after ?? L.noScore), delta(d.scores[b].before, d.scores[b].after)]),
      [L.middle, String(mb ?? "--"), String(ma ?? "--"), `${delta(mb, ma)} ${L.pts}`],
    ],
    [0.28, 0.25, 0.25, 0.22],
    8.5,
    true,
  );
  for (const b of BUREAUS) {
    const s = d.scores[b];
    const line = `${(BUREAU_FULL[b] + ":").padEnd(12)} ${pv2AsciiBar(s.after)} ${s.before ?? L.noScore} -> ${s.after ?? L.noScore} (${delta(s.before, s.after)} ${L.pts})`;
    p1.text(line, p1.M, p1.y, 8.5, mono, PV2.navy);
    p1.y -= 12;
  }
  if (d.sinceStart) {
    const s0 = pv2MiddleScore(d.sinceStart.scores);
    // Only when it adds information: a different start than this table's baseline.
    if (s0 !== null && ma !== null && d.sinceStart.date !== d.baselineDate && s0 !== mb) {
      p1.y -= 2;
      p1.text(L.sinceStart(d.sinceStart.date, s0, ma), p1.M, p1.y, 8.5, bold, PV2.navy);
      p1.y -= 12;
    }
  }
  p1.y -= 8;
  // Cesar Oct 26 (#1): no "What Moved Your Score" in the client PDF — new negatives go to the
  // targets table and the internal case notes.
  const sinceStartOnly = d.winsScope === "since_start";
  if (!d.parseFailure && !d.startingPoint) p1.heading(sinceStartOnly ? L.cameOffSinceStart : L.cameOffThisRound);
  const winTargets: Pv2Target[] = d.wins.map((w) => ({
    item: w.item,
    bureaus: w.bureaus,
    detail: L.impactText(w.impact, w.kind, w.status === "PARTIAL" ? w.bureaus.length : 0),
    priority: w.impact,
    lift: 0,
    kind: w.kind === "inquiry" ? "inquiry" : "account",
    round: undefined,
    ...(w.status === "PARTIAL" ? { accuracy: [L.partial(w.remainsOn.join("/"))] } : {}),
  }));
  const winPlan = pv2TargetRows(winTargets, Math.max(2, Math.floor(130 / 20)), d.lang);
  const winRows = winPlan.rows.map((r, i) => {
    const w = winTargets.length === winPlan.rows.length ? d.wins[i] : null;
    return [r[0], r[1], r[2], w ? (w.status === "PARTIAL" ? L.partial(w.remainsOn.join("/")) : L.removed) : L.removed];
  });
  if (winRows.length) p1.table([L.itemRemoved, L.bureaus, L.impact, L.status], winRows, [0.4, 0.14, 0.26, 0.2], 7.8);
  if (!sinceStartOnly && d.winsSinceStart?.length) {
    p1.para(L.sinceStartWins(d.winsSinceStart.length, d.winsSinceStart.map((w) => w.item.replace(/ - [^-]+$/, "")).join("; ")), 8, PV2.navy, bold);
  }
  // #8: always shown (Kathy example) — client actions, or the standing reminder.
  p1.callout(L.progressToo, d.clientActions.length ? L.progressTooBody(d.clientActions.join("; ")) : L.progressNone);
  if (d.parseFailure) {
    // Spec: a parse failure is not "no wins" / "no targets" — print nothing.
  } else p1.heading(L.stillOn(d.programRound ?? d.round));
  // #4: targets = the negative ACCOUNTS on the current report; inquiries are one summary row.
  const acctTargets = d.targets.filter((t) => t.kind !== "inquiry");
  const inqTargets = d.targets.filter((t) => t.kind === "inquiry");
  const allRows = pv2TargetRows(acctTargets, 60, d.lang).rows;
  if (inqTargets.length) {
    const perB = BUREAUS.map((b) => [b, inqTargets.filter((t) => t.bureaus.includes(b)).length] as const).filter(([, n]) => n > 0);
    allRows.push([L.inquirySummary(inqTargets.length, perB.map(([b, n]) => `${b} ${n}`).join(" / ")), perB.map(([b]) => b).join(" / "), inqTargets.map((t) => t.item.replace(/ - [^-]+$/, "")).filter((v, i, a) => a.indexOf(v) === i).join("; "), L.prio("LOW")]);
  }
  // Rows that do not fit page 1 continue on page 2 (#10: never squeezed out, page 2 filled).
  const fitP1 = Math.max(2, Math.floor(Math.max(48, p1.y - 50) / 24));
  const p1Rows = allRows.slice(0, fitP1);
  const restRows = allRows.slice(fitP1);
  const tcols = [0.32, 0.14, 0.4, 0.14];
  const theads = [L.item, L.bureaus, L.detail, L.priority];
  if (p1Rows.length) p1.table(theads, p1Rows, tcols, 7.5);
  else if (!d.parseFailure) p1.para(L.noTargets, 9, PV2.muted);
  if (stats) {
    stats.targetsRepresented = acctTargets.length + inqTargets.length;
    stats.winsRepresented = winPlan.represented;
  }

  // ── Page 2: utilization + what's working ──────────────────────────────────
  const p2 = pages[1];
  if (restRows.length) {
    p2.heading(L.stillOnCont(d.programRound ?? d.round));
    p2.table(theads, restRows, tcols, 7.5);
  }
  p2.heading(L.utilTitle);
  const uo = d.utilizationOverall;
  p2.para(L.utilIntro(uo.before, uo.after, uo.bureau ? BUREAU_FULL[uo.bureau] : ""));
  // P2-3: amount to pay down (never a target balance that could be read both ways).
  const payDown = (amt: number) => (amt <= 0 ? L.alreadyOk : pv2Money(amt));
  const uRows = d.utilization.map((u) => [u.account, pv2Money(u.limit), u.baseline === null ? "--" : pv2Money(u.baseline), pv2Money(u.current), `${u.pct}% ${L.band(u.pct)}`, payDown(u.payDown30), payDown(u.payDown10)]);
  if (uRows.length) {
    // Total row = the overall bureau's own accounts (label says which bureau).
    const totalRows = uo.bureau ? d.utilization.filter((u) => u.bureau === uo.bureau) : d.utilization;
    const lim = totalRows.reduce((s, u) => s + u.limit, 0);
    // P1-3: unknown baseline in any row = "--" in the total (never $0).
    const base = totalRows.some((u) => u.baseline === null) ? null : totalRows.reduce((s, u) => s + (u.baseline ?? 0), 0);
    const cur = totalRows.reduce((s, u) => s + u.current, 0);
    const fitted = pv2Fit(uRows, 18, 300);
    fitted.push([L.totalRevolving(uo.bureau ?? ""), pv2Money(lim), base === null ? "--" : pv2Money(base), pv2Money(cur), lim > 0 ? `${Math.round((cur / lim) * 100)}%` : "--", "", ""]);
    p2.table([L.account, L.limit, L.baseBal, L.curBal, L.used, L.payTo30h, L.payTo10h], fitted, [0.22, 0.11, 0.13, 0.13, 0.13, 0.14, 0.14], 7.8, true);
  } else p2.para(L.noUtil, 9, PV2.muted);
  for (const n of d.utilizationNotes.slice(0, 3)) p2.para(n, 7.5, PV2.muted);
  p2.heading(L.working);
  for (const s of d.positives.slice(0, 5)) {
    for (const [i, l] of p2.wrap(s, 9, p2.CW - 14).entries()) {
      if (i === 0) p2.page.drawCircle({ x: p2.M + 3, y: p2.y + 3, size: 1.6, color: PV2.gold });
      p2.text(l, p2.M + 12, p2.y, 9);
      p2.y -= 12.5;
    }
  }
  p2.y -= 6;
  p2.heading(L.actionNeeded);
  for (const s of d.actionNeeded.slice(0, 3)) p2.para(s);
  if (d.informational?.length && p2.y > 150) {
    p2.text(L.verifiedTitle, p2.M, p2.y, 9.5, bold, PV2.navy);
    p2.y -= 13;
    p2.para(L.verifiedBody, 8, PV2.muted);
    for (const it of d.informational.slice(0, 3)) p2.para(`${it.item} (${it.bureaus.join("/") || "N/I"}) - ${it.detail}`, 8.3);
  }

  // ── Page 3: roadmap + goal + plan + file strength + CROA ──────────────────
  const p3 = pages[2];
  p3.heading(L.roadmap);
  const highUtil = d.utilization.filter((u) => u.pct > 30).slice(0, 3).map((u) => u.account).join(", ");
  // P1-1: program round (case stage) vs dispute round (per item); the active row = Step 1's set.
  const programRound = d.programRound ?? d.round;
  const active = d.activeSet && d.activeSet.items.length ? d.activeSet.items.join(", ") : L.nextTargets;
  const roadmap: Array<[string, string, string]> = [
    [L.roundsDone(programRound), L.removedCount((d.winsScope === "since_start" ? d.wins : d.winsSinceStart ?? d.wins).length), L.done],
    [L.roundActive(programRound), active, L.inProgress],
    ...(d.utilization.length ? ([[L.utilization, highUtil ? L.bringUnder(highUtil) : L.keepUnder, L.clientAction]] as Array<[string, string, string]>) : []),
    [L.scoreGoal, L.projected(d.goal.low, d.goal.high), L.target],
  ];
  for (const [a, b, c] of roadmap) {
    p3.text(`${a.padEnd(24)} -> `, p3.M, p3.y, 8.5, mono, PV2.navy);
    p3.text(c, p3.M + p3.CW - bold.widthOfTextAtSize(c, 8), p3.y, 8, bold, c === L.done ? PV2.green : PV2.navy);
    // Wrapped (never truncated): the active set must match Step 1 in full.
    const lines = p3.wrap(b, 8.5, 225);
    lines.forEach((l, i) => {
      p3.text(l, p3.M + 200, p3.y - i * 10.5, 8.5);
    });
    p3.y -= 14 + (lines.length - 1) * 10.5;
  }
  p3.y -= 6;
  p3.table(
    [L.middle, ""],
    [
      [L.currentRow, String(ma ?? "--")],
      [L.goalRow, L.goalVal(d.goal.low, d.goal.high)],
      [L.gapRow, ma === null ? "--" : `${Math.max(0, d.goal.low - ma)}-${Math.max(0, d.goal.high - ma)} ${L.points}`],
    ],
    [0.5, 0.5],
    8.5,
  );
  p3.heading(L.plan);
  d.plan.slice(0, 5).forEach((s, i) => p3.para(`${L.step(i + 1)} - ${s}`, 8.8));
  p3.heading(L.strength);
  const fsN = Math.round((d.fileStrength / 100) * 20);
  p3.text(`${L.strengthBar}: [${"=".repeat(fsN)}${" ".repeat(20 - fsN)}] ${d.fileStrength} / 100`, p3.M, p3.y, 9, mono, PV2.navy);
  p3.y -= 15;
  p3.para(d.fileStrengthNote, 8.8);
  p3.para(L.questions(d.phone, d.site), 8.8, PV2.muted);
  p3.y = Math.max(p3.y, 120);
  p3.callout(L.croaTitle, L.croa);

  if (stats) {
    stats.pages = pdf.getPageCount();
    stats.croaText = L.croa;
    stats.clientText = [...d.positives, ...d.actionNeeded, ...d.plan, ...d.wins.map((w) => w.item), ...d.targets.map((t) => t.item), d.fileStrengthNote];
  }
  return Buffer.from(await pdf.save());
}

// ── assemble report content from the diff ──────────────────────────────────

export function pv2BuildPdfData(opts: {
  diff: Pv2Diff;
  clientFirstName: string;
  clientName: string;
  round: number;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  phone: string;
  site: string;
  address?: string;
  sinceStart?: { date: string; scores: Record<Bureau, number | null> } | null;
  lang?: Pv2Lang;
  /** P1-2: the main diff compares to the enrollment baseline (no prior-round pull). */
  winsScope?: "this_round" | "since_start";
  /** P1-2: baseline → this After, when the main diff is round-over-round. */
  sinceStartDiff?: Pv2Diff | null;
  /** P1-1: case program round active after this report (default: round + 1). */
  programRound?: number;
}): Pv2PdfData {
  const lang = opts.lang ?? "en";
  const L = pv2L(lang);
  const { diff } = opts;
  const ma = pv2MiddleScore({ TU: opts.scores.TU.after, EX: opts.scores.EX.after, EQ: opts.scores.EQ.after }) ?? 0;
  // P0-5: v2.1 §6 per-bureau projection on the verified scores — +100 cumulative per bureau, never above 760.
  const goalByBureau = Object.fromEntries(
    BUREAUS.map((b) => {
      const cur = opts.scores[b].after;
      const lift = diff.projectionLift?.[b] ?? [0, 0];
      if (cur === null) return [b, null];
      const cap = Math.max(cur, Math.min(760, cur + 100));
      return [b, [Math.min(cap, cur + lift[0]), Math.min(cap, cur + lift[1])]];
    }),
  ) as Record<Bureau, [number, number] | null>;
  const midOf = (i: 0 | 1) => pv2MiddleScore({ TU: goalByBureau.TU?.[i] ?? null, EX: goalByBureau.EX?.[i] ?? null, EQ: goalByBureau.EQ?.[i] ?? null }) ?? ma;
  const goal = { low: Math.max(ma, midOf(0)), high: Math.max(ma, midOf(1)) };
  // Cesar Oct 26 (#3): ONE round number in the whole report — the case round. The roadmap and
  // Step 1 list the same set: the negative accounts still on the report (#4), plus an inquiry count.
  const programRound = opts.programRound ?? opts.round;
  const activeItems = [...new Set(diff.targets.filter((t) => t.kind !== "inquiry").map((t) => t.item.replace(/ - [^-]+$/, "")))];
  const inquiryCount = diff.targets.filter((t) => t.kind === "inquiry").length;
  const activeSet = activeItems.length || inquiryCount ? { disputeRound: programRound, items: activeItems.length ? activeItems : [] } : null;
  const accountTargets = diff.targets.filter((t) => t.kind !== "inquiry");
  // Major derogatories: open charge-offs / collections + open accounts 90+ late.
  // Verified-but-remaining items are still negatives on the file.
  const major = diff.after.openDerogatory + diff.after.severeOpenAccounts;
  const fileStrengthParts = pv2FileStrengthParts({
    lates24m: diff.after.lates24m,
    olderLates: diff.after.olderLates,
    activeSevereDelinquency: diff.after.activeSevereDelinquency,
    overallUtil: diff.utilizationOverall.after,
    openChargeOffsOrCollections: major,
    otherNegatives: Math.max(0, accountTargets.length + diff.informational.length - major),
    publicRecord: diff.after.publicRecord,
    oldestYears: diff.after.oldestYears,
    hasRevolving: diff.after.hasRevolving,
    hasInstallment: diff.after.hasInstallment,
    openRevolving: diff.after.openRevolving,
  });
  const fileStrength = fileStrengthParts.total;
  const high = diff.utilization.filter((u) => u.pct > 30);
  const actionNeeded: string[] = [];
  if (high.length) {
    actionNeeded.push(
      L.actionUtil(high[0].account, high[0].pct, pv2Money(high[0].current), pv2Money(high[0].limit), high.slice(1, 4).map((u) => `${u.account} (${u.pct}%)`).join(", ")),
    );
  }
  actionNeeded.push(L.keepCurrent);
  const plan = [
    L.planOfg(programRound, `${activeItems.join(", ")}${inquiryCount ? L.planOfgWithInquiries(inquiryCount) : ""}`),
    // #9: no "keep cards under 30%" when there is no open revolving account.
    diff.utilization.length ? L.planClient(high.slice(0, 4).map((u) => u.account).join(L.then)) : L.planNoCards,
    L.planProtect(programRound),
    L.planTimeline(programRound),
    L.planNext(programRound),
  ];
  const strengths: string[] = [];
  if (diff.positivesFlags.history) strengths.push(L.sHistory);
  if (diff.positivesFlags.noCollections) strengths.push(L.sNoColl);
  if (diff.utilization.reduce((s, u) => s + u.limit, 0) >= 20000) strengths.push(L.sLimits);
  // #10: no repeated names.
  const growth = [...new Set(diff.targets.filter((t) => t.kind !== "inquiry").map((t) => t.item.split(" - ")[0].replace(/ \([^)]*\)$/, "")))].slice(0, 2).concat(high.length ? [L.gUtil] : []);
  return {
    lang,
    clientFirstName: opts.clientFirstName,
    clientName: opts.clientName,
    baselineDate: diff.beforeDate ?? "--",
    currentDate: diff.afterDate ?? "--",
    round: opts.round,
    scores: opts.scores,
    wins: diff.wins,
    clientActions: diff.clientActions,
    targets: diff.targets,
    utilization: diff.utilization,
    utilizationOverall: diff.utilizationOverall,
    utilizationNotes: diff.utilizationNotes,
    positives: diff.positives,
    actionNeeded,
    goal,
    fileStrength,
    fileStrengthParts,
    fileStrengthNote: L.strengthNote(strengths.join(", "), growth.join(", ")),
    plan,
    phone: opts.phone,
    site: opts.site,
    address: opts.address,
    sinceStart: opts.sinceStart ?? null,
    movementFacts: diff.movementFacts,
    informational: diff.informational,
    winsScope: opts.winsScope ?? "this_round",
    winsSinceStart: opts.sinceStartDiff ? opts.sinceStartDiff.wins : null,
    programRound,
    activeSet,
    goalByBureau,
  };
}

// ── Section 9: pull summaries + self-check (Spec v1.1) ──────────────────────

/** One pull's own Account Summary (SmartCredit page 1), per bureau. */
export type Pv2ReportFormat = "smartcredit" | "identityiq" | "mfsn" | "myfico" | "trimerge";

/** Bump when a summary parser changes: cached summaries from an older parser are re-parsed. */
export const PV2_SUMMARY_PARSER_VERSION = 3;

export interface Pv2PullSummary {
  /** Parser that produced this summary (cached copies older than PV2_SUMMARY_PARSER_VERSION are re-parsed). */
  parserVersion?: number;
  /** Which layout printed it (missing on summaries cached before multi-format support = SmartCredit). */
  format?: Pv2ReportFormat;
  /** Report / pull date printed in the report body (never the browser print header). MM/DD/YYYY. */
  reportDate?: string | null;
  perBureau: Record<
    Bureau,
    {
      totalAccounts: number | null;
      openAccounts: number | null;
      closedAccounts: number | null;
      balances: number | null;
      publicRecords: number | null;
      /** SmartCredit / IdentityIQ: hard inquiries in the last 2 years; MyFreeScoreNow: all listed. */
      inquiries2y: number | null;
      collections?: number | null;
    } | null
  >;
  /** Credit Utilization table: revolving used / total limit per bureau. */
  revolving: Record<Bureau, { used: number; limit: number } | null>;
  /** Lender tri-merge: one combined Credit Summary for all repositories. */
  merged?: { totalAccounts: number | null; openAccounts: number | null; publicRecords: number | null; collections: number | null } | null;
  /** Account blocks / table-of-contents entries the PDF itself prints (layout count, not a bureau total). */
  accountsPrinted?: number | null;
  /** SmartCredit: each account's Credit Limit row read from the PDF text (parser v3+). */
  printedLimits?: ScPrintedLimit[];
  /** MyFreeScoreNow: creditor of each table-of-contents entry, in order (parser v3+). */
  tocCreditors?: string[];
  /** SmartCredit / IdentityIQ: the inquiry list as printed in the text (parser v3+). */
  printedInquiries?: CreditInquiry[];
}

const PV2_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "August 07, 2026" | "8/25/2026" → "08/07/2026". */
function pv2Ymd(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  let m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = PV2_MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)));
    return mi < 0 ? null : `${String(mi + 1).padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : null;
}

/** Which consumer / lender layout printed this text. */
export function pv2DetectReportFormat(text: string): Pv2ReportFormat | null {
  // Lender tri-merges (Xactus, Factual Data, …) also print FICO 3B scores — check them first.
  if (/Repositories:/i.test(text) && /Credit Summary/i.test(text)) return "trimerge";
  if (/myfico\.com|myFICO 3-Bureau Report/i.test(text)) return "myfico";
  if (/identityiq/i.test(text)) return "identityiq";
  if (/smartcredit\.com|Ultra 4K 3B Report/i.test(text)) return "smartcredit";
  if (/Three Bureau Credit Report/i.test(text) && /(Equifax|Experian|TransUnion) Accounts Summary/i.test(text)) return "mfsn";
  if (/Repositories:/i.test(text) && /Credit Summary/i.test(text)) return "trimerge";
  if (/Total Accounts/i.test(text) && /Inquiries \(2 Years\)/i.test(text)) return "smartcredit";
  return null;
}

const pv2Amt = (v: string | undefined): number | null => {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const pv2EmptyBureaus = () => ({ TU: null, EX: null, EQ: null });

/**
 * MyFreeScoreNow (powered by Equifax): one "Accounts Summary" table per bureau
 * (Equifax, Experian, TransUnion order) — open accounts by type, revolving
 * balance / limit — plus "Other Credit Items" (inquiries, public records,
 * collections). Every account is listed in the table of contents.
 */
function pv2ParseMfsnSummary(text: string): Pv2PullSummary | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const order: Bureau[] = ["EQ", "EX", "TU"];
  const perBureau = pv2EmptyBureaus() as Pv2PullSummary["perBureau"];
  const revolving = pv2EmptyBureaus() as Pv2PullSummary["revolving"];
  const heads = lines.map((l, i) => (/^Account Type Open With Balance/i.test(l) ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  // "You currently have no TransUnion Accounts Summary" = that bureau was not pulled. The tables are then
  // matched to bureaus by position in scrambled text, so their per-bureau open counts can't be trusted
  // (Juan, Oct 26: Experian's "2 open" landed on TransUnion and blocked a complete Before as half-loaded).
  const noSummary = new Set(
    lines
      .map((l) => /You currently have no (Equifax|Experian|TransUnion) Accounts Summary/i.exec(l)?.[1]?.toLowerCase())
      .filter(Boolean)
      .map((n) => (n === "equifax" ? "EQ" : n === "experian" ? "EX" : "TU") as Bureau),
  );
  const positional = noSummary.size === 0;
  heads.forEach((h, k) => {
    const b = order[k];
    const row = (label: string) => lines.slice(h + 1, h + 8).find((l) => new RegExp(`^${label}\\b`, "i").test(l))?.split(/\s+/) ?? null;
    const total = row("Total");
    const rev = row("Revolving");
    perBureau[b] = {
      totalAccounts: null,
      openAccounts: positional && total ? pv2Amt(total[1]) : null,
      closedAccounts: null,
      balances: null,
      publicRecords: null,
      inquiries2y: null,
      collections: null,
    };
    if (positional && rev && pv2Amt(rev[5]) !== null) revolving[b] = { used: pv2Amt(rev[3]) ?? 0, limit: pv2Amt(rev[5])! };
  });
  for (const b of noSummary) {
    if (perBureau[b]) perBureau[b] = { ...perBureau[b]!, openAccounts: 0 };
  }
  const other = (label: string) => {
    const l = lines.find((x) => new RegExp(`^${label}\\s+\\d+\\s+\\d+\\s+\\d+$`, "i").test(x));
    return l ? l.split(/\s+/).slice(-3).map(Number) : null;
  };
  const inq = other("Inquiries");
  const pr = other("Public Records");
  const coll = other("Collections");
  order.forEach((b, i) => {
    if (!perBureau[b] && !inq) return;
    perBureau[b] = {
      ...(perBureau[b] ?? { totalAccounts: null, openAccounts: null, closedAccounts: null, balances: null }),
      publicRecords: pr ? pr[i] : null,
      inquiries2y: inq ? inq[i] : null,
      collections: coll ? coll[i] : null,
    } as NonNullable<Pv2PullSummary["perBureau"][Bureau]>;
  });
  // Table of contents: "2.1 Prestigio Jewelers I 3" under the Revolving / Mortgage / Installment / Other sections.
  const sections = new Set(
    lines.map((l) => /^(\d+)\. (Revolving|Mortgage|Installment|Other) Accounts \d+$/i.exec(l)?.[1]).filter((x): x is string => !!x),
  );
  const tocLines = lines.filter((l) => {
    const m = /^(\d+)\.\d+ \S.* \d+$/.exec(l);
    return !!m && sections.has(m[1]);
  });
  const toc = tocLines.length;
  // Creditor of each entry ("4.1 Ed Financial/esa (CLOSED) 24" → "Ed Financial/esa").
  const tocCreditors = tocLines.map((l) => l.replace(/^\d+\.\d+ /, "").replace(/ \d+$/, "").replace(/\s*\((CLOSED|OPEN)\)\s*$/i, "").trim());
  const dateRow = lines.find((l) => /^Report Date\s+[A-Za-z]+ \d{1,2}, \d{4}/.test(l));
  const date = dateRow ? pv2Ymd(/^Report Date\s+([A-Za-z]+ \d{1,2}, \d{4})/.exec(dateRow)![1]) : null;
  if (!heads.length && !inq && !toc) return null;
  const printedLimits = parseMfsnPrintedAccounts(text);
  return { format: "mfsn", reportDate: date, perBureau, revolving, accountsPrinted: toc || null, ...(tocCreditors.length ? { tocCreditors } : {}), ...(printedLimits.length ? { printedLimits } : {}) };
}

/**
 * myFICO 3-Bureau: the summary is a chart (no totals in the text). The report
 * date is "AS OF M/D/YYYY" (the browser header carries the print date), and
 * every account block prints one "Last Updated" row.
 */
function pv2ParseMyficoSummary(text: string): Pv2PullSummary | null {
  const date = pv2Ymd(/AS OF (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)?.[1]);
  const blocks = (text.match(/^Last Updated\b/gm) ?? []).length;
  if (!date && !blocks) return null;
  return { format: "myfico", reportDate: date, perBureau: pv2EmptyBureaus() as Pv2PullSummary["perBureau"], revolving: pv2EmptyBureaus() as Pv2PullSummary["revolving"], accountsPrinted: blocks || null };
}

/**
 * Lender tri-merge "Credit Summary" (combined repositories): Totals row
 * (number of accounts, open accounts, …) and the Public Records /
 * Collections-Charge-offs block; report date = Ordered.
 */
function pv2ParseTrimergeSummary(text: string): Pv2PullSummary | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const totals = lines.find((l) => /^Totals\s+\d+\s+\d+/.test(l))?.split(/\s+/) ?? null;
  // Label block ("Public Records:", "Collections/Charge-offs:", "Bankruptcy:") followed by the same number of values.
  const valueAfter = (label: RegExp): number | null => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return null;
    let start = i;
    while (start > 0 && /:\s*$/.test(lines[start - 1])) start--;
    let end = i;
    while (end + 1 < lines.length && /:\s*$/.test(lines[end + 1])) end++;
    const v = lines[end + 1 + (i - start)];
    return pv2Amt(v);
  };
  const date = pv2Ymd(/Ordered:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1]);
  if (!totals && !date) return null;
  return {
    format: "trimerge",
    reportDate: date,
    perBureau: pv2EmptyBureaus() as Pv2PullSummary["perBureau"],
    revolving: pv2EmptyBureaus() as Pv2PullSummary["revolving"],
    merged: {
      totalAccounts: totals ? pv2Amt(totals[1]) : null,
      openAccounts: totals ? pv2Amt(totals[2]) : null,
      publicRecords: valueAfter(/^Public Records:\s*$/i),
      collections: valueAfter(/^Collections\/Charge-offs:\s*$/i),
    },
  };
}

/**
 * Reader hint from the report's own counts, so the read returns every account
 * (the MyFreeScoreNow read skipped its whole "Other Accounts" section).
 */
export function pv2AccountHint(summary: Pv2PullSummary | null | undefined): string | null {
  if (!summary) return null;
  const per = BUREAUS.map((b) => [b, summary.perBureau[b]?.totalAccounts] as const).filter((x): x is readonly [Bureau, number] => x[1] != null);
  if (per.length) {
    const names: Record<Bureau, string> = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };
    return `This report's own summary lists ${per.map(([b, n]) => `${n} accounts on ${names[b]}`).join(", ")} — return every one of them.`;
  }
  const printed = summary.accountsPrinted ?? summary.merged?.totalAccounts;
  return printed ? `This report lists ${printed} accounts (table of contents / account sections / credit summary) — return all ${printed}, including every "Other Accounts" and collection entry.` : null;
}

/** Any supported layout → the pull's own summary (null when the layout prints none). */
export function pv2ParsePullSummary(text: string): Pv2PullSummary | null {
  const s = pv2ParsePullSummaryLayout(text);
  return s ? { ...s, parserVersion: PV2_SUMMARY_PARSER_VERSION } : null;
}

/**
 * Repairs a SmartCredit read from facts the PDF prints (Nov 6, 2026): each account's Credit Limit
 * row (Emiliano: the read took Bank of America's High Balance $1,279 as its $500 limit) and the
 * section it is printed under (Jose: two cards read as revolving are printed outside "Revolving
 * Accounts", which is all SmartCredit's utilization table counts). Guarded so a correct read is
 * never touched: changes apply only when the read misses a printed revolving-limit total, they make
 * it match, and no bureau that matched stops matching. A printed fact is used only when every
 * entry for the same creditor and number agrees on it. Returns the same object when nothing changes.
 */
/**
 * Every guarded repair from facts the PDF prints, in order: revolving limits + sections, balances,
 * inquiries. Each step changes a bureau only when the read misses that bureau's printed total and
 * the printed values make it match. Returns the same object when nothing changes.
 */
export function pv2ApplyPrintedFacts<F extends CreditFile>(file: F, summary: Pv2PullSummary | null | undefined): F {
  let f = file;
  const notes: string[] = [];
  for (const step of [pv2ApplyPrintedLimits, pv2ApplyPrintedBalances, pv2ApplyPrintedInquiries, pv2ApplyPrintedLates]) {
    const next = step(f, summary);
    if (next !== f) notes.push(...pv2RepairNotes(f, next));
    f = next;
  }
  return notes.length ? { ...f, printedRepairs: [...(file.printedRepairs ?? []), ...notes] } : f;
}

/** What a repair step changed, in words staff can check against the PDF ("CAPITAL ONE …5178 TU: limit $1,279 → $500"). */
export function pv2RepairNotes(before: CreditFile, after: CreditFile): string[] {
  const notes: string[] = [];
  const name = (a: CreditAccount) => `${a.creditor}${a.mask ? ` …${String(a.mask).replace(/[^0-9a-z]/gi, "").slice(-4)}` : ""}`;
  const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
  // A dropped duplicate: the before list minus the after list (same object or same name, in order).
  let rest = before.accounts;
  if (after.accounts.length < before.accounts.length) {
    const left = [...after.accounts];
    const kept: CreditAccount[] = [];
    for (const a of before.accounts) {
      const i = left.findIndex((x) => x === a || (x.creditor === a.creditor && x.mask === a.mask));
      if (i >= 0) {
        kept.push(a);
        left.splice(i, 1);
      } else notes.push(`${name(a)}: duplicate copy of the same card removed`);
    }
    rest = kept;
  }
  rest.forEach((a, i) => {
    const b = after.accounts[i];
    if (!b) return;
    if (a.section !== b.section) notes.push(`${name(a)}: section ${a.section} → ${b.section}`);
    for (const x of BUREAUS) {
      const p = a.bureaus[x];
      const q = b.bureaus[x];
      if (!p || !q) continue;
      if (p.creditLimit !== q.creditLimit) notes.push(`${name(a)} ${x}: limit ${money(p.creditLimit)} → ${money(q.creditLimit)}`);
      if (p.balance !== q.balance) notes.push(`${name(a)} ${x}: balance ${money(p.balance)} → ${money(q.balance)}`);
      if (p.late30 !== q.late30 || p.late60 !== q.late60 || p.late90 !== q.late90) {
        notes.push(`${name(a)} ${x}: lates ${p.late30 ?? 0}/${p.late60 ?? 0}/${p.late90 ?? 0} → ${q.late30 ?? 0}/${q.late60 ?? 0}/${q.late90 ?? 0} (30/60/90)`);
      }
    }
  });
  if (before.inquiries !== after.inquiries) {
    for (const x of BUREAUS) {
      const n0 = before.inquiries.filter((q) => q.bureau === x).length;
      const n1 = after.inquiries.filter((q) => q.bureau === x).length;
      if (n0 !== n1) notes.push(`${x} inquiries ${n0} → ${n1} (the printed list)`);
    }
  }
  return notes;
}

/**
 * Late-payment counts from each account's "Days Late - Last 7 Years" row (Nov 6, 2026). They decide
 * which accounts are negative, so a misread count changes dispute items and "removed" wins. No printed
 * total exists for them, so the guard is the match: used only when exactly one printed account fits
 * (creditor + number, then Date Opened, then balance for look-alikes); anything ambiguous stays as read.
 */
export function pv2ApplyPrintedLates<F extends CreditFile>(file: F, summary: Pv2PullSummary | null | undefined): F {
  const printed = summary?.printedLimits?.filter((p) => p.lates);
  if (!printed?.length) return file;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const digits = (m: string | null | undefined) => String(m ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  let changed = false;
  const accounts = file.accounts.map((a) => {
    const own = digits(a.mask);
    let base = printed.filter((p) => norm(p.creditor) === norm(a.creditor));
    if (own) {
      const ends = base.filter((p) => digits(p.mask).endsWith(own));
      base = ends.length ? ends : base.filter((p) => !digits(p.mask) || digits(p.mask).includes(own) || own.includes(digits(p.mask)));
    }
    let next = a;
    for (const b of BUREAUS) {
      const t = a.bureaus[b];
      if (!t) continue;
      let cands = base.filter((p) => p.lates![b]);
      if (cands.length > 1) {
        const mo = pv2Month(t.dateOpened);
        const byOpen = cands.filter((p) => mo && pv2Month(p.opened?.[b]) === mo);
        cands = byOpen.length ? byOpen : cands;
      }
      if (cands.length > 1 && t.balance != null) cands = cands.filter((p) => p.balances?.[b] === t.balance);
      if (cands.length !== 1) continue;
      const l = cands[0].lates![b]!;
      if (t.late30 === l.late30 && t.late60 === l.late60 && t.late90 === l.late90) continue;
      // Never clear lates the read saw in the payment grid (a grid mark can be an icon the text lacks).
      const lowers = (t.late30 ?? 0) > (l.late30 ?? 0) || (t.late60 ?? 0) > (l.late60 ?? 0) || (t.late90 ?? 0) > (l.late90 ?? 0);
      if (lowers && (t.gridMarks ?? []).some((m) => /:(30|60|90|120|150|180|CO|C)$/i.test(String(m)))) continue;
      next = { ...next, bureaus: { ...next.bureaus, [b]: { ...t, late30: l.late30, late60: l.late60, late90: l.late90 } } };
      changed = true;
    }
    return next;
  });
  return changed ? { ...file, accounts } : file;
}

const pv2Month = (d: string | null | undefined) => {
  const m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(String(d ?? "").trim());
  return m ? `${m[2]}-${m[1].padStart(2, "0")}` : null;
};

/**
 * Balances from each account's Balance Owed row (Nov 6, 2026 audit: three recent files off by $4k-$27k).
 * Look-alike accounts that print one number (11 Central Research loans "510000****") are told apart
 * by the Date Opened row.
 */
export function pv2ApplyPrintedBalances<F extends CreditFile>(file: F, summary: Pv2PullSummary | null | undefined): F {
  const printed = summary?.printedLimits?.filter((p) => p.balances);
  if (!printed?.length || !summary) return file;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const digits = (m: string | null | undefined) => String(m ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  let accounts = file.accounts;
  for (const b of BUREAUS) {
    const want = summary.perBureau?.[b]?.balances;
    if (want == null) continue;
    const tol = Math.max(10, want * 0.01);
    const total = (list: CreditAccount[]) => list.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
    if (Math.abs(total(accounts) - want) <= tol) continue;
    const repaired = accounts.map((a) => {
      const t = a.bureaus[b];
      if (!t) return a;
      const own = digits(a.mask);
      let cands = printed.filter((p) => norm(p.creditor) === norm(a.creditor) && p.balances![b] != null);
      if (own) {
        const ends = cands.filter((p) => digits(p.mask).endsWith(own));
        cands = ends.length ? ends : cands.filter((p) => !digits(p.mask) || digits(p.mask).includes(own) || own.includes(digits(p.mask)));
      }
      const values = new Set(cands.map((p) => p.balances![b]!));
      if (values.size > 1) {
        const mo = pv2Month(t.dateOpened);
        const sameOpen = cands.filter((p) => mo && pv2Month(p.opened?.[b]) === mo);
        values.clear();
        for (const p of sameOpen) values.add(p.balances![b]!);
      }
      if (values.size !== 1) return a;
      const v = [...values][0];
      return v === t.balance ? a : { ...a, bureaus: { ...a.bureaus, [b]: { ...t, balance: v } } };
    });
    if (Math.abs(total(repaired) - want) <= tol) accounts = repaired;
  }
  return accounts === file.accounts ? file : { ...file, accounts };
}

/** Inquiries from the printed list, per bureau, when the read's 2-year count misses the printed total and the list matches it. */
export function pv2ApplyPrintedInquiries<F extends CreditFile>(file: F, summary: Pv2PullSummary | null | undefined): F {
  const printed = summary?.printedInquiries;
  if (!printed?.length || !summary) return file;
  const asOf = parseReportDate(file.reportDate);
  const count = (list: CreditInquiry[], b: Bureau) =>
    list.filter((q) => {
      if (q.bureau !== b) return false;
      const d = parseReportDate(q.date);
      return !d || !asOf || pv2WithinTwoYears(d, asOf);
    }).length;
  let inquiries = file.inquiries;
  for (const b of BUREAUS) {
    const want = summary.perBureau?.[b]?.inquiries2y;
    if (want == null || count(inquiries, b) === want || count(printed, b) !== want) continue;
    inquiries = [...inquiries.filter((q) => q.bureau !== b), ...printed.filter((q) => q.bureau === b)];
  }
  return inquiries === file.inquiries ? file : { ...file, inquiries };
}

export function pv2ApplyPrintedLimits<F extends CreditFile>(file: F, summary: Pv2PullSummary | null | undefined): F {
  const printed = summary?.printedLimits;
  if (!printed?.length || !summary) return file;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const digits = (m: string | null | undefined) => String(m ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  const entriesFor = (a: CreditAccount) => {
    const name = norm(a.creditor);
    const own = digits(a.mask);
    const same = printed.filter((p) => norm(p.creditor) === name);
    if (!own) return same;
    // Same visible number first (read "3800" = printed "133800"); then any overlap ("4147" in "414718").
    const ends = same.filter((p) => digits(p.mask).endsWith(own));
    return ends.length ? ends : same.filter((p) => !digits(p.mask) || digits(p.mask).includes(own) || own.includes(digits(p.mask)));
  };
  const unanimous = <T,>(values: Array<T | undefined>): T | null => {
    const set = new Set(values.filter((v): v is T => v !== undefined));
    return set.size === 1 ? [...set][0] : null;
  };
  const openRevolving = (a: CreditAccount, b: Bureau) => a.section === "revolving" && !!a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a);
  const bureaus = BUREAUS.filter((b) => summary.revolving?.[b]?.limit != null);
  if (!bureaus.length) return file;
  const ok = (list: CreditAccount[], b: Bureau) => {
    const want = summary.revolving[b]!.limit;
    const got = list.reduce((n, a) => n + (openRevolving(a, b) ? a.bureaus[b]!.creditLimit ?? 0 : 0), 0);
    return Math.abs(got - want) <= Math.max(50, want * 0.02);
  };
  const before = new Map(bureaus.map((b) => [b, ok(file.accounts, b)]));
  if (bureaus.every((b) => before.get(b))) return file;

  const withSections = file.accounts.map((a) => {
    const entries = entriesFor(a);
    // Several printed accounts share a number (Jose: 13 SchoolsFirst loans + 1 line of credit): keep
    // the ones whose printed limits agree with this account's limits.
    const agrees = entries.filter((p) => BUREAUS.every((b) => p.limits[b] == null || a.bureaus[b]?.creditLimit == null || p.limits[b] === a.bureaus[b]!.creditLimit));
    const section = unanimous(entries.map((p) => p.section)) ?? unanimous(agrees.map((p) => p.section));
    // Only whether an account counts as revolving changes (what the utilization total measures);
    // collections and every other classification stay as read.
    const intoRevolving = section === "revolving" && a.section !== "revolving" && a.section !== "collection";
    const outOfRevolving = a.section === "revolving" && !!section && section !== "revolving";
    return intoRevolving || outOfRevolving ? { ...a, section: section! } : a;
  });
  const withLimits = (list: CreditAccount[], only?: Bureau) =>
    list.map((a) => {
      let next = a;
      for (const b of only ? [only] : bureaus) {
        if (!openRevolving(a, b)) continue;
        const v = unanimous(entriesFor(a).map((p) => p.limits[b]));
        const t = a.bureaus[b]!;
        if (v != null && v !== t.creditLimit) next = { ...next, bureaus: { ...next.bureaus, [b]: { ...t, creditLimit: v } } };
      }
      return next;
    });
  const better = (list: CreditAccount[]) =>
    bureaus.every((b) => !before.get(b) || ok(list, b)) && bureaus.some((b) => !before.get(b) && ok(list, b));

  // One card read twice under two fragments of its printed number (Nov 6, 2026: "7805" and "5178" of
  // 517805****, identical limits / balances / open dates): the second copy is dropped — only as a
  // candidate, so it applies just when the totals then match.
  const sameData = (x: CreditAccount, y: CreditAccount) =>
    BUREAUS.every((b) => {
      const p = x.bureaus[b];
      const q = y.bureaus[b];
      if (!p || !q) return !p && !q;
      return p.balance === q.balance && p.creditLimit === q.creditLimit && pv2Month(p.dateOpened) === pv2Month(q.dateOpened) && String(p.accountStatus ?? "") === String(q.accountStatus ?? "");
    });
  const deduped = file.accounts.filter((a, i) => {
    const own = digits(a.mask);
    if (!own) return true;
    return !file.accounts.some((o, j) => {
      if (j >= i || norm(o.creditor) !== norm(a.creditor) || digits(o.mask) === own || !digits(o.mask) || !sameData(o, a)) return false;
      // Both numbers sit inside one printed number of this creditor.
      return printed.some((p) => norm(p.creditor) === norm(a.creditor) && digits(p.mask).includes(own) && digits(p.mask).includes(digits(o.mask)));
    });
  });
  // Sections + limits together, else limits alone (per bureau, as before); each also without the duplicate.
  const both = withLimits(withSections);
  if (better(both)) return { ...file, accounts: both };
  if (deduped.length < file.accounts.length) {
    const dedupedSections = withSections.filter((a) => deduped.some((d) => d === file.accounts[withSections.indexOf(a)]));
    for (const candidate of [deduped, withLimits(deduped), withLimits(dedupedSections)]) {
      if (better(candidate)) return { ...file, accounts: candidate };
    }
  }
  let accounts = file.accounts;
  for (const b of bureaus) {
    if (before.get(b)) continue;
    const repaired = withLimits(accounts, b);
    if (ok(repaired, b)) accounts = repaired;
  }
  return accounts === file.accounts ? file : { ...file, accounts };
}

function pv2ParsePullSummaryLayout(text: string): Pv2PullSummary | null {
  const format = pv2DetectReportFormat(text);
  if (format === "mfsn") return pv2ParseMfsnSummary(text);
  if (format === "myfico") return pv2ParseMyficoSummary(text);
  if (format === "trimerge") return pv2ParseTrimergeSummary(text);
  if (format === "smartcredit" || format === "identityiq") {
    const s = pv2ParseSmartCreditSummary(text);
    const date = pv2Ymd(text.split(/\r?\n/).map((l) => /^(\d{2}\/\d{2}\/\d{4})\s*\t\s*\d{2}\/\d{2}\/\d{4}/.exec(l.trim())?.[1]).find(Boolean));
    // Same 3B layout for SmartCredit and IdentityIQ; every repair below is guarded by the printed totals.
    const printedLimits = parseSmartCreditPrintedLimits(text);
    const printedInquiries = parseSmartCredit(text).inquiries;
    const extra = { ...(printedLimits.length ? { printedLimits } : {}), ...(printedInquiries.length ? { printedInquiries } : {}) };
    return s ? { ...s, format, reportDate: date, ...extra } : date ? { format, reportDate: date, perBureau: pv2EmptyBureaus() as Pv2PullSummary["perBureau"], revolving: pv2EmptyBureaus() as Pv2PullSummary["revolving"], ...extra } : null;
  }
  return null;
}

const PV2_CELL = String.raw`(\$?[\d,]+|——|--|-|N\/A)`;
const PV2_TRIPLE = new RegExp(`^${PV2_CELL}\\s*\\t\\s*${PV2_CELL}\\s*\\t\\s*${PV2_CELL}$`);
const pv2Cell = (v: string): number | null => (/^\$?[\d,]+$/.test(v) ? Number(v.replace(/[$,]/g, "")) : null);

/**
 * SmartCredit "Summary" block: 9 rows × (TransUnion, Experian, Equifax) —
 * Total, Open, Closed, Delinquent, Derogatory, Balances, Payments, Public
 * Records, Inquiries (2 Years). Located by shape (5 counts, 2 money rows,
 * 2 counts) and Total = Open + Closed. null when not found.
 */
export function pv2ParseSmartCreditSummary(text: string): Pv2PullSummary | null {
  if (!/Total Accounts/i.test(text) || !/Inquiries \(2 Years\)/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rows: Array<{ raw: string[]; i: number }> = [];
  lines.forEach((l, i) => {
    const m = PV2_TRIPLE.exec(l);
    if (m) rows.push({ raw: [m[1], m[2], m[3]], i });
  });
  const isMoney = (r: string[]) => r.some((v) => v.startsWith("$")) && r.every((v) => v.startsWith("$") || !/\d/.test(v));
  const isCount = (r: string[]) => r.every((v) => !v.startsWith("$"));
  for (let k = 0; k + 9 <= rows.length; k++) {
    const w = rows.slice(k, k + 9);
    if (w[8].i - w[0].i !== 8) continue; // consecutive lines
    const shape = w.slice(0, 5).every((r) => isCount(r.raw)) && isMoney(w[5].raw) && isMoney(w[6].raw) && isCount(w[7].raw) && isCount(w[8].raw);
    if (!shape) continue;
    const ok = [0, 1, 2].every((c) => {
      const [t, o, cl] = [pv2Cell(w[0].raw[c]), pv2Cell(w[1].raw[c]), pv2Cell(w[2].raw[c])];
      return t === null || o === null || cl === null || t === o + cl;
    });
    if (!ok) continue;
    const order: Bureau[] = ["TU", "EX", "EQ"];
    const perBureau = Object.fromEntries(
      order.map((b, c) => {
        const v = (r: number) => pv2Cell(w[r].raw[c]);
        const any = [0, 5, 8].some((r) => v(r) !== null);
        return [b, any ? { totalAccounts: v(0), openAccounts: v(1), closedAccounts: v(2), balances: v(5), publicRecords: v(7), inquiries2y: v(8) } : null];
      }),
    ) as Pv2PullSummary["perBureau"];
    const revolving = { TU: null, EX: null, EQ: null } as Pv2PullSummary["revolving"];
    const names: Record<string, Bureau> = { transunion: "TU", experian: "EX", equifax: "EQ" };
    for (const l of lines) {
      const m = /^(TransUnion|Experian|Equifax)\S*\s*\t\s*\$([\d,]+)\s*\t\s*\$([\d,]+)\s*\t/i.exec(l);
      if (m) revolving[names[m[1].toLowerCase()]] = { used: Number(m[2].replace(/,/g, "")), limit: Number(m[3].replace(/,/g, "")) };
    }
    return { perBureau, revolving };
  }
  return null;
}

/**
 * Half-loaded SmartCredit print, detected against the pull's own summary:
 * any bureau where the read holds under 90% of the accounts the summary lists.
 */
/**
 * Entries the reader returned, never fewer than the accounts it holds (a stored read can carry a
 * stale entry count below its own accounts — Jeser R1: 34 entries, 38 accounts — which made a
 * complete file look short).
 */
export function pv2ReadEntries(file: CreditFile): number {
  return Math.max(file.readEntries ?? 0, file.accounts.length);
}

/**
 * Creditors the report prints more accounts for than the read holds (Nov 6, 2026 — one of 11
 * Central Research loans and one of 14 Dept of Ed loans were missing; a 1-of-39 gap never reached
 * the 10% shortfall). Uses the SmartCredit text headers when every page is text. A card printed as
 * two blocks (one numbered, one "****") counts once.
 */
export function pv2CreditorShortfall(file: CreditFile, skeleton: CreditFile | null): Array<{ creditor: string; printed: number; read: number }> {
  if (!skeleton || skeleton.provider !== "smartcredit" || skeleton.imagePages > 0 || !skeleton.accounts?.length) return [];
  // Reads spell creditors their own way ("LVNV FUNDING" vs "LVNV FUNDING LLC"): group on the first 8 letters.
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  // Counted PER BUREAU: one debt printed as separate blocks per bureau (debt buyers, split cards) is one
  // account on each bureau, so it is never "missing". Block bureaus come from its Days Late row.
  const count = (accounts: CreditAccount[], confidentOnly: boolean) => {
    const m = new Map<string, { name: string; perBureau: Record<Bureau, number> }>();
    for (const a of accounts) {
      if (confidentOnly && !a.confident) continue;
      const k = key(a.creditor);
      if (k.length < 4) continue;
      const e = m.get(k) ?? { name: a.creditor, perBureau: { TU: 0, EX: 0, EQ: 0 } };
      for (const b of BUREAUS) if (a.bureaus[b]) e.perBureau[b]++;
      m.set(k, e);
    }
    return m;
  };
  const printed = count(skeleton.accounts, true);
  const read = count(file.accounts, false);
  const out: Array<{ creditor: string; printed: number; read: number }> = [];
  for (const [k, p] of printed) {
    const r = read.get(k);
    // A creditor the read never names is a spelling the read changed, not a missing account.
    if (!r) continue;
    const worst = BUREAUS.map((b) => ({ printed: p.perBureau[b], read: r.perBureau[b] })).filter((x) => x.printed > x.read).sort((x, y) => y.printed - y.read - (x.printed - x.read))[0];
    if (worst) out.push({ creditor: p.name, ...worst });
  }
  return out;
}

/**
 * MyFreeScoreNow: creditors its table of contents lists more entries for than the read holds, for the
 * reconcile pass hint only (the read merges one debt's per-bureau copies, so this over-reports;
 * the trigger is the entry count). At most as many accounts as entries are missing.
 */
export function pv2TocCreditorShortfall(file: CreditFile, summary: Pv2PullSummary | null): Array<{ creditor: string; printed: number; read: number }> {
  const toc = summary?.tocCreditors;
  if (!toc?.length) return [];
  const missing = Math.max(0, (summary?.accountsPrinted ?? toc.length) - pv2ReadEntries(file));
  if (!missing) return [];
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const printed = new Map<string, { name: string; n: number }>();
  for (const name of toc) {
    const k = key(name);
    if (k.length < 4) continue;
    printed.set(k, { name: printed.get(k)?.name ?? name, n: (printed.get(k)?.n ?? 0) + 1 });
  }
  const read = new Map<string, number>();
  for (const a of file.accounts) read.set(key(a.creditor), (read.get(key(a.creditor)) ?? 0) + 1);
  return [...printed]
    .filter(([k, p]) => p.n > (read.get(k) ?? 0))
    .map(([k, p]) => ({ creditor: p.name, printed: p.n, read: Math.max(read.get(k) ?? 0, p.n - missing) }));
}

export function pv2SummaryShortfall(file: CreditFile, summary: Pv2PullSummary | null): string | null {
  if (!summary) return null;
  const short: string[] = [];
  // Layout count (MyFreeScoreNow table of contents, myFICO account blocks) and tri-merge totals.
  // Layout count vs entries before same-account copies were merged (reads stored before
  // readEntries existed are skipped: their merged count is not comparable). Tri-merge rows are never merged.
  const printed = summary.accountsPrinted != null && file.readEntries != null ? summary.accountsPrinted : (summary.merged?.totalAccounts ?? null);
  const entries = summary.accountsPrinted != null && file.readEntries != null ? pv2ReadEntries(file) : file.accounts.length;
  if (printed && entries < printed * 0.9) short.push(`${entries} of ${printed} accounts`);
  for (const b of BUREAUS) {
    const total = summary.perBureau[b]?.totalAccounts;
    if (!total) continue;
    const parsed = file.accounts.filter((a) => a.bureaus[b]).length;
    if (parsed < total * 0.9) short.push(`${b} ${parsed} of ${total}`);
  }
  // A bureau the summary shows open accounts for, with nothing read on that bureau (MyFreeScoreNow
  // Before for Juan: TransUnion column never read → every TransUnion item looked "new").
  for (const b of BUREAUS) {
    const open = summary.perBureau[b]?.openAccounts;
    if (summary.perBureau[b]?.totalAccounts != null || !open) continue;
    if (!file.accounts.some((a) => a.bureaus[b])) short.push(`${b} 0 of ${open} open accounts`);
  }
  // Account names without their details (the list page loaded, the account pages did not): balances missing.
  for (const b of BUREAUS) {
    const want = summary.perBureau[b]?.balances;
    if (!want || want < 1000) continue;
    const got = file.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
    if (got < want * 0.5) short.push(`${b} balances $${Math.round(got).toLocaleString("en-US")} of $${want.toLocaleString("en-US")}`);
  }
  return short.length ? short.join(", ") : null;
}

export interface Pv2Check {
  key:
    | "account_totals"
    | "balances"
    | "limits"
    | "inquiries"
    | "public_records"
    | "collections"
    | "scores"
    | "chronology"
    | "contradictions"
    | "target_count"
    | "positives_in_targets"
    | "projection"
    | "pages_croa"
    | "language"
    /** Informational: what was corrected from the PDF's own rows before checking (only when something was). */
    | "printed_repairs";
  /** null = not applicable (the pull prints no summary for it). */
  pass: boolean | null;
  detail: string;
}

/** Items in two conflicting states on one bureau (REMOVED + still a target). */
export function pv2Contradictions(diff: Pick<Pv2Diff, "wins" | "targets">): string[] {
  const out: string[] = [];
  const base = (s: string) => s.replace(/ \([^)]*\)/g, "").replace(/ - [^-]+$/, "").trim();
  for (const w of diff.wins) {
    for (const t of diff.targets) {
      if ((w.kind === "inquiry") !== (t.kind === "inquiry")) continue;
      const same = w.kind === "inquiry" ? w.item === t.item : pv2CreditorSimilar(base(w.item), base(t.item));
      if (!same) continue;
      const both = w.bureaus.filter((b) => t.bureaus.includes(b));
      if (both.length) out.push(`${base(w.item)} removed and still reporting on ${both.join("/")}`);
    }
  }
  return out;
}

const PV2_BANNED = /largest score suppressor|30-60 days|next statement cycle|30-60 dias|proximo estado de cuenta|\.\.\.|…/i;

/**
 * Section 9: reconcile the engine against each pull's own summary and itself.
 * Any failure → NEEDS_REVIEW (no client send) with the failing check named.
 */
/** Scores in the report that differ from what each pull's read shows (either side, any bureau, including a score typed for a bureau with none). */
export function pv2ScoreMismatches(
  scores: Record<Bureau, { before: number | null; after: number | null }>,
  before: Pick<CreditFile, "scores"> | null,
  after: Pick<CreditFile, "scores"> | null,
): string[] {
  const out: string[] = [];
  const hasAny = (f: Pick<CreditFile, "scores"> | null) => !!f && BUREAUS.some((b) => f.scores[b] !== null);
  for (const b of BUREAUS) {
    for (const [label, k, f] of [["Before", "before", before], ["After", "after", after]] as const) {
      // A read with no scores at all (image-only page) cannot contradict anything.
      if (!hasAny(f)) continue;
      const typed = scores[b][k] ?? null;
      const read = f!.scores[b] ?? null;
      if (typed !== read) out.push(`${b} ${label}: report ${typed ?? "no score"}, PDF ${read ?? "no score"}`);
    }
  }
  return out;
}

/**
 * Account count vs the pull's own summary on one bureau (Oct 29, 2026 — Andrea R5).
 * Fewer accounts than the summary = missing data (a missing After account would look
 * "removed") → always fails. More accounts can be the summary's own undercount (SmartCredit
 * listed 25 Equifax accounts — two look-alike Capital One cards, $500 and $750 high balance —
 * under a "24" total). An extra account never creates a win, so a small over-count
 * (≤ max(1, 3%)) passes with a note — unless a negative account appears twice on that bureau
 * (a double read would duplicate a target), which still fails. When the summary also prints
 * open / closed counts, neither may come up short: a double-counted account must not hide a
 * missing one (net +1 = 2 copies of one account and a missing late account → a false win).
 */
export function pv2AccountCountVerdict(
  accounts: CreditAccount[],
  b: Bureau,
  got: number,
  want: number,
  printedSplit?: { open: number | null; closed: number | null },
): "ok" | "note" | "fail" {
  if (got === want) return "ok";
  if (got < want) return "fail";
  if (got - want > Math.max(1, Math.round(want * 0.03))) return "fail";
  if (printedSplit && (printedSplit.open != null || printedSplit.closed != null)) {
    const on = accounts.filter((a) => a.bureaus[b]);
    const closed = on.filter((a) => isClosedTradeline(a.bureaus[b]!, a)).length;
    if (printedSplit.open != null && on.length - closed < printedSplit.open) return "fail";
    if (printedSplit.closed != null && closed < printedSplit.closed) return "fail";
  }
  const seen = new Set<string>();
  for (const a of accounts) {
    const tl = a.bureaus[b];
    if (!tl || !isNegativeTradeline(tl, a)) continue;
    const key = `${pv2NormCreditor(a.creditor)}|${(a.mask ?? "").replace(/\*/g, "")}|${tl.dateOpened ?? ""}`;
    if (seen.has(key)) return "fail";
    seen.add(key);
  }
  return "note";
}

export function pv2SelfCheck(input: {
  before: CreditFile;
  after: CreditFile;
  summaries: { before: Pv2PullSummary | null; after: Pv2PullSummary | null };
  diff: Pv2Diff;
  pdf: Pv2PdfData;
  stats: Pv2RenderStats;
  recordTargets: number;
  /** Round 1 starting point: one report on purpose (same pull on both sides). */
  startingPoint?: boolean;
}): { pass: boolean; checks: Pv2Check[] } {
  const { diff, pdf, stats } = input;
  const checks: Pv2Check[] = [];
  const pulls: Array<["Before" | "After", CreditFile, Pv2PullSummary | null]> = [
    ["Before", input.before, input.summaries.before],
    ["After", input.after, input.summaries.after],
  ];
  const perPull = (key: Pv2Check["key"], fn: (label: string, f: CreditFile, s: Pv2PullSummary) => string[] | null) => {
    const bad: string[] = [];
    let applicable = false;
    for (const [label, f, s] of pulls) {
      if (!s) continue;
      const r = fn(label, f, s);
      if (r === null) continue;
      applicable = true;
      bad.push(...r);
    }
    checks.push({ key, pass: applicable ? bad.length === 0 : null, detail: applicable ? (bad.length ? bad.join("; ") : "matches the pull summary") : "pull prints no summary" });
  };
  // Small over-counts the summary itself explains (see pv2AccountCountVerdict): shown, not failed.
  const totalsNotes: string[] = [];
  perPull("account_totals", (label, f, s) => {
    const out: string[] = [];
    let any = false;
    for (const b of BUREAUS) {
      const total = s.perBureau[b]?.totalAccounts;
      const open = s.perBureau[b]?.openAccounts;
      if (total != null) {
        any = true;
        const got = f.accounts.filter((a) => a.bureaus[b]).length;
        const v = pv2AccountCountVerdict(f.accounts, b, got, total, { open: s.perBureau[b]?.openAccounts ?? null, closed: s.perBureau[b]?.closedAccounts ?? null });
        if (v === "fail") out.push(`${label} ${b}: ${got} accounts read, summary ${total}`);
        else if (v === "note") totalsNotes.push(`${label} ${b}: ${got} accounts read, summary ${total} (the report lists more than its own summary; no account missing)`);
      } else if (open != null) {
        // MyFreeScoreNow prints open accounts per bureau (no total).
        any = true;
        const openAccts = f.accounts.filter((a) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a));
        const v = pv2AccountCountVerdict(openAccts, b, openAccts.length, open);
        if (v === "fail") out.push(`${label} ${b}: ${openAccts.length} open accounts read, summary ${open}`);
        else if (v === "note") totalsNotes.push(`${label} ${b}: ${openAccts.length} open accounts read, summary ${open} (the report lists more than its own summary; no account missing)`);
      }
    }
    // Layout count (table of contents / account blocks: entries before copies are merged) and tri-merge totals.
    const layout = s.accountsPrinted != null && f.readEntries != null;
    const printed = layout ? s.accountsPrinted! : (s.merged?.totalAccounts ?? null);
    if (printed != null) {
      any = true;
      const got = layout ? pv2ReadEntries(f) : f.accounts.length;
      // One-sided: layouts can list collections / closed accounts outside the count, so only missing accounts fail.
      if (got < printed - Math.max(1, Math.round(printed * 0.05))) out.push(`${label}: ${got} accounts read, the report lists ${printed}`);
    }
    return any ? out : null;
  });
  {
    const c = checks[checks.length - 1];
    if (c.key === "account_totals" && c.pass === true && totalsNotes.length) c.detail = totalsNotes.join("; ");
  }
  perPull("balances", (label, f, s) => {
    const out: string[] = [];
    let any = false;
    for (const b of BUREAUS) {
      const want = s.perBureau[b]?.balances;
      if (want == null) continue;
      any = true;
      const got = f.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
      if (Math.abs(got - want) > Math.max(10, want * 0.01)) out.push(`${label} ${b}: balances $${Math.round(got).toLocaleString("en-US")} vs summary $${want.toLocaleString("en-US")}`);
    }
    return any ? out : null;
  });
  perPull("limits", (label, f, s) => {
    const out: string[] = [];
    let any = false;
    for (const b of BUREAUS) {
      const want = s.revolving[b]?.limit;
      if (want == null) continue;
      any = true;
      const got = f.accounts
        .filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a))
        .reduce((n, a) => n + (a.bureaus[b]!.creditLimit ?? 0), 0);
      if (Math.abs(got - want) > Math.max(50, want * 0.02)) out.push(`${label} ${b}: revolving limits $${Math.round(got).toLocaleString("en-US")} vs summary $${want.toLocaleString("en-US")}`);
    }
    return any ? out : null;
  });
  perPull("inquiries", (label, f, s) => {
    const out: string[] = [];
    let any = false;
    const asOf = parseReportDate(f.reportDate);
    for (const b of BUREAUS) {
      const want = s.perBureau[b]?.inquiries2y;
      if (want == null) continue;
      any = true;
      // SmartCredit / IdentityIQ count the last 2 years (by calendar date); MyFreeScoreNow counts every listed inquiry.
      const got = f.inquiries.filter((q) => {
        if (q.bureau !== b) return false;
        const d = parseReportDate(q.date);
        return !d || !asOf || s.format === "mfsn" || pv2WithinTwoYears(d, asOf);
      }).length;
      if (got !== want) out.push(`${label} ${b}: ${got} inquiries read, summary ${want}`);
    }
    return any ? out : null;
  });
  {
    const s = input.summaries.after;
    const pr = s
      ? [...BUREAUS.map((b) => s.perBureau[b]?.publicRecords), s.merged?.publicRecords].filter((n): n is number => n != null)
      : [];
    const prTargets = diff.targets.filter((t) => /public record|registro publico|bankrupt/i.test(t.item)).length;
    checks.push(
      !pr.length
        ? { key: "public_records", pass: null, detail: "pull prints no summary" }
        : pr.every((n) => n === 0) && prTargets
          ? { key: "public_records", pass: false, detail: `summary shows 0 public records but ${prTargets} public-record target(s)` }
          : { key: "public_records", pass: true, detail: "matches the pull summary" },
    );
  }
  perPull("collections", (label, f, s) => {
    const isColl = (a: CreditAccount, b?: Bureau) =>
      a.section === "collection" || BUREAUS.some((x) => (!b || x === b) && a.bureaus[x] && /collection/i.test(`${a.bureaus[x]!.paymentStatus ?? ""} ${a.bureaus[x]!.accountStatus ?? ""} ${a.bureaus[x]!.accountType ?? ""}`));
    const out: string[] = [];
    let any = false;
    for (const b of BUREAUS) {
      const want = s.perBureau[b]?.collections;
      if (want == null) continue;
      any = true;
      const got = f.accounts.filter((a) => a.bureaus[b] && isColl(a, b)).length;
      if (Math.abs(got - want) > 1) out.push(`${label} ${b}: ${got} collections read, summary ${want}`);
    }
    const merged = s.merged?.collections;
    if (merged != null) {
      any = true;
      // Tri-merge "Collections/Charge-offs".
      const got = f.accounts.filter((a) => isColl(a) || BUREAUS.some((x) => a.bureaus[x] && /charge.?off|charged off/i.test(`${a.bureaus[x]!.paymentStatus ?? ""} ${a.bureaus[x]!.accountStatus ?? ""}`))).length;
      if (Math.abs(got - merged) > 1) out.push(`${label}: ${got} collections / charge-offs read, summary ${merged}`);
    }
    return any ? out : null;
  });
  {
    // §9: one score per bureau, 300-850, matching the reports (Nov 2, 2026): a typed score
    // that differs from the read holds the report; a release manager can override with a reason.
    const bad: string[] = [];
    for (const b of BUREAUS) {
      for (const [k, v] of [["before", pdf.scores[b].before], ["after", pdf.scores[b].after]] as const) {
        if (v !== null && (v < 300 || v > 850)) bad.push(`${b} ${k} ${v} outside 300-850`);
      }
    }
    const differs = pv2ScoreMismatches(pdf.scores, input.before, input.after);
    checks.push({
      key: "scores",
      pass: !bad.length && !differs.length,
      detail: bad.length || differs.length ? [...bad, ...differs].join("; ") : "one score per bureau, matches both pulls",
    });
  }
  {
    const bd = parseReportDate(input.before.reportDate);
    const ad = parseReportDate(input.after.reportDate);
    const ok = input.startingPoint || (!!bd && !!ad && ad.getTime() > bd.getTime());
    checks.push({ key: "chronology", pass: ok, detail: input.startingPoint ? `starting point ${input.after.reportDate ?? "?"}` : `${input.before.reportDate ?? "?"} -> ${input.after.reportDate ?? "?"}` });
  }
  {
    const c = pv2Contradictions(diff);
    checks.push({ key: "contradictions", pass: !c.length, detail: c.length ? c.join("; ") : "0" });
  }
  {
    const ok = stats.targetsRepresented === diff.targets.length && input.recordTargets === diff.targets.length;
    checks.push({ key: "target_count", pass: ok, detail: `PDF ${stats.targetsRepresented} / record ${input.recordTargets} / engine ${diff.targets.length}` });
  }
  {
    let hits: string[];
    if (diff.positiveAccountKeys && diff.targetAccountKeys) {
      // Account-level: a clean card is not "in the targets" because a late card shares its creditor name.
      hits = diff.positiveAccountKeys.filter((k) => diff.targetAccountKeys!.some((t) => pv2SameAccountKey(k, t)));
    } else {
      // Diffs stored before the account keys existed: name match (conservative).
      const names = diff.targets.filter((t) => t.kind !== "inquiry").map((t) => t.item.replace(/ \([^)]*\)/g, "").replace(/ - [^-]+$/, "").trim());
      hits = pdf.positives.filter((p) => names.some((n) => n.length >= 3 && p.toUpperCase().includes(n.toUpperCase())));
    }
    checks.push({ key: "positives_in_targets", pass: !hits.length, detail: hits.length ? hits.join("; ") : "0" });
  }
  {
    const bad: string[] = [];
    for (const b of BUREAUS) {
      const r = pdf.goalByBureau?.[b];
      const cur = pdf.scores[b].after;
      if (!r || cur === null) continue;
      if (r[1] > Math.min(760, cur + 100) && r[1] > cur) bad.push(`${b} ${r[1]} > cap ${Math.min(760, cur + 100)}`);
    }
    checks.push({ key: "projection", pass: !bad.length, detail: bad.length ? bad.join("; ") : `goal ${pdf.goal.low}-${pdf.goal.high}` });
  }
  {
    const ok = stats.pages === 3 && stats.croaText.includes("15 U.S.C. §1679 et seq.");
    checks.push({ key: "pages_croa", pass: ok, detail: `${stats.pages} pages; CROA ${stats.croaText.includes("§1679") ? "verbatim" : "missing citation"}` });
  }
  {
    const bad = stats.clientText.filter((t) => PV2_BANNED.test(t));
    checks.push({ key: "language", pass: !bad.length, detail: bad.length ? bad.join(" | ").slice(0, 300) : "facts only" });
  }
  // Staff see every value the platform corrected from the PDF's own rows before these checks ran.
  {
    const lines = ([["Before", input.before], ["After", input.after]] as const).flatMap(([label, f]) => (f.printedRepairs ?? []).map((n) => `${label}: ${n}`));
    if (lines.length) checks.push({ key: "printed_repairs", pass: true, detail: `${lines.slice(0, 12).join("; ")}${lines.length > 12 ? `; … and ${lines.length - 12} more` : ""}` });
  }
  return { pass: checks.every((c) => c.pass !== false), checks };
}

/**
 * Read speed (Oct 27): a split read (page ranges read in parallel, then merged) is only
 * trusted when it matches the report's OWN printed totals. Verifiable = the pull prints
 * per-bureau account totals (or a layout count). Mismatch → the caller reads it in one pass.
 */
export function pv2SplitReadVerifiable(summary: Pv2PullSummary | null | undefined): boolean {
  if (!summary) return false;
  return BUREAUS.some((b) => (summary.perBureau?.[b]?.totalAccounts ?? 0) > 0) || (summary.accountsPrinted ?? 0) > 0;
}

export function pv2SplitReadVerified(
  file: CreditFile,
  summary: Pv2PullSummary | null | undefined,
): { ok: boolean; why: string } {
  if (!pv2SplitReadVerifiable(summary)) return { ok: false, why: "the report prints no totals to verify against" };
  const s = summary!;
  const off: string[] = [];
  const near = (got: number, want: number, pct: number) => Math.abs(got - want) <= Math.max(1, Math.round(want * pct));
  for (const b of BUREAUS) {
    const want = s.perBureau?.[b]?.totalAccounts ?? 0;
    if (want > 0) {
      const got = file.accounts.filter((a) => a.bureaus[b]).length;
      if (!near(got, want, 0.1)) off.push(`${b} ${got} of ${want} accounts`);
    }
    const bal = s.perBureau?.[b]?.balances ?? 0;
    if (bal >= 1000) {
      const got = file.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
      if (!near(got, bal, 0.1)) off.push(`${b} balances $${Math.round(got)} vs $${bal}`);
    }
  }
  if ((s.accountsPrinted ?? 0) > 0 && file.readEntries != null && !near(pv2ReadEntries(file), s.accountsPrinted!, 0.1)) {
    off.push(`${pv2ReadEntries(file)} of ${s.accountsPrinted} printed accounts`);
  }
  return off.length ? { ok: false, why: off.join(", ") } : { ok: true, why: "matches the report's own totals" };
}

// ── Score update (Oct 28, 2026) ─────────────────────────────────────────────
// When a SmartCredit PDF was saved before its account pages loaded, the full
// report cannot be built (missing accounts would look "removed"). Cesar's call:
// send a short, approved Score update instead — scores always, inquiries only
// from what the report itself prints, itemized only when both reads are proven
// complete. The next round runs the full engine and shows all account progress.

export interface Pv2ScoreUpdateInquiries {
  /** Hard inquiries (last 2 years) the report prints on its own summary, per bureau. */
  counts: Record<Bureau, { before: number | null; after: number | null }>;
  /** Removed inquiries — only when both reads match the printed counts on every bureau. */
  removed: Pv2Win[];
  verified: boolean;
  reason: string;
}

/**
 * Inside a report's "last 2 years" window, by calendar date like the bureau summaries:
 * on an 08/31/2026 report, 08/31/2024 counts and 08/30/2024 does not (Nov 3, 2026).
 */
export function pv2WithinTwoYears(d: Date, asOf: Date): boolean {
  const cutoff = new Date(asOf.getTime());
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  return d.getTime() >= cutoff.getTime() && d.getTime() <= asOf.getTime();
}

/** Read inquiries on one bureau dated within 2 years of the pull (the summary's window). */
function pv2Inquiries2y(file: CreditFile, b: Bureau): number | null {
  const pulled = parseReportDate(file.reportDate);
  if (!pulled) return null;
  let n = 0;
  for (const q of file.inquiries) {
    if (q.bureau !== b) continue;
    const d = parseReportDate(q.date);
    if (!d) return null;
    if (pv2WithinTwoYears(d, pulled)) n++;
  }
  return n;
}

export function pv2ScoreUpdateInquiries(o: {
  before: CreditFile | null;
  after: CreditFile | null;
  summaryBefore: Pv2PullSummary | null;
  summaryAfter: Pv2PullSummary | null;
  lang?: Pv2Lang;
}): Pv2ScoreUpdateInquiries {
  const printed = (s: Pv2PullSummary | null, b: Bureau) => {
    const v = s?.perBureau?.[b]?.inquiries2y;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const counts = Object.fromEntries(
    BUREAUS.map((b) => [b, { before: printed(o.summaryBefore, b), after: printed(o.summaryAfter, b) }]),
  ) as Record<Bureau, { before: number | null; after: number | null }>;
  const none = (reason: string): Pv2ScoreUpdateInquiries => ({ counts, removed: [], verified: false, reason });
  const { before, after } = o;
  if (!before || !after) return none("a read is missing");
  if (!BUREAUS.every((b) => counts[b].before !== null && counts[b].after !== null)) {
    return none("the reports do not print inquiry totals for every bureau");
  }
  if ([...before.inquiries, ...after.inquiries].some((q) => q.bureau === null)) {
    return none("an inquiry does not say which bureau it is on");
  }
  for (const [side, file] of [["Before", before], ["After", after]] as const) {
    for (const b of BUREAUS) {
      const read = pv2Inquiries2y(file, b);
      const want = side === "Before" ? counts[b].before : counts[b].after;
      if (read === null) return none(`${side} has an undated inquiry or no report date`);
      if (read !== want) return none(`${side} ${b}: read ${read} of ${want} printed inquiries`);
    }
  }
  // Both inquiry sections are complete: the engine's own inquiry rules (canonical names,
  // 2-year aging, one row per company + date). Accounts are left out on purpose.
  const inquiryOnly = (f: CreditFile): CreditFile => ({ ...f, accounts: [] });
  const removed = pv2Diff(inquiryOnly(before), inquiryOnly(after), o.lang ?? "en").wins.filter((w) => w.kind === "inquiry");
  return { counts, removed, verified: true, reason: "both reads match the printed inquiry totals" };
}

/** Self-check for a Score update: staff-verified scores on both pulls, dates in order. */
export function pv2ScoreUpdateSelfCheck(o: {
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  beforeDate: string | null;
  afterDate: string | null;
  inquiries: Pv2ScoreUpdateInquiries;
  /** Same rule as the full report: typed scores must match the reads. */
  reads?: { before: Pick<CreditFile, "scores"> | null; after: Pick<CreditFile, "scores"> | null };
}): { pass: boolean; checks: Pv2Check[] } {
  const both = BUREAUS.filter((b) => o.scores[b].before !== null && o.scores[b].after !== null);
  const differs = o.reads ? pv2ScoreMismatches(o.scores, o.reads.before, o.reads.after) : [];
  const bd = parseReportDate(o.beforeDate);
  const ad = parseReportDate(o.afterDate);
  const checks: Pv2Check[] = [
    {
      key: "scores",
      pass: both.length > 0 && !differs.length,
      detail: differs.length ? differs.join("; ") : both.length ? `Scores on both reports: ${both.join(", ")}` : "No bureau has a score on both reports — enter them in review",
    },
    {
      key: "chronology",
      pass: bd && ad ? bd.getTime() < ad.getTime() : null,
      detail: bd && ad ? (bd.getTime() < ad.getTime() ? "Before is the older report" : "Before is not older than After") : "Report dates not printed",
    },
    {
      key: "inquiries",
      pass: o.inquiries.verified ? true : null,
      detail: o.inquiries.verified ? `Itemized (${o.inquiries.reason})` : `Totals only (${o.inquiries.reason})`,
    },
  ];
  return { pass: checks.every((c) => c.pass !== false), checks };
}

export interface Pv2ScoreUpdateData {
  lang: Pv2Lang;
  clientName: string;
  clientFirstName: string;
  round: number;
  baselineDate: string;
  currentDate: string;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  inquiries: Pv2ScoreUpdateInquiries;
  phone: string;
  site: string;
  address?: string;
}

function pv2ScoreUpdateL(lang: Pv2Lang) {
  const es = lang === "es";
  return {
    brand: "OPTIMUM FINANCIAL GROUP",
    noScore: es ? "Sin puntaje" : "No score",
    title: es ? "ACTUALIZACION DE PUNTAJE" : "CREDIT SCORE UPDATE",
    preparedFor: (n: string, b: string, c: string) => (es ? `Preparado para: ${n}  |  Base ${b}  |  Actual ${c}` : `Prepared for: ${n}  |  Baseline ${b}  |  Current ${c}`),
    scores: es ? "Tus puntajes" : "Your Scores",
    intro: (first: string, round: number) =>
      es
        ? `${first}, esta es tu actualizacion de puntaje de la Ronda ${round}. La revision completa, cuenta por cuenta, se incluira en tu proximo informe de progreso.`
        : `${first}, here is your score update for Round ${round}. Your full account-by-account review will be included in your next progress report.`,
    bureau: es ? "Buro" : "Bureau",
    baseline: (d: string) => (es ? `Base ${d}` : `Baseline ${d}`),
    current: (d: string) => (es ? `Actual ${d}` : `Current ${d}`),
    change: es ? "Cambio" : "Change",
    middle: es ? "Puntaje medio" : "Middle score",
    pts: "pts",
    inquiries: es ? "Consultas de credito (ultimos 2 anos)" : "Hard Inquiries (last 2 years)",
    inquiriesNote: es ? "Totales impresos en tus informes de credito." : "Totals as printed on your credit reports.",
    inquiriesNone: es ? "El detalle de consultas se incluira en tu proximo informe completo." : "Inquiry details will be included in your next full report.",
    removedHeading: es ? "Consultas eliminadas" : "Inquiries Removed",
    item: es ? "Consulta" : "Inquiry",
    bureaus: es ? "Buros" : "Bureaus",
    next: es ? "Que sigue" : "What Comes Next",
    nextBody: es
      ? "Tus disputas continuan segun el plan. En tu proximo informe veras cada actualizacion de tus cuentas, incluido todo lo eliminado durante esta ronda. Si tienes preguntas, llamanos."
      : "Your disputes continue as planned. Your next report will show every account update, including anything removed during this round. Questions? Give us a call.",
    page: es ? "Pagina 1 de 1" : "Page 1 of 1",
  };
}

/** One-page, branded Score update (same header/footer as the progress report). */
export async function generateScoreUpdatePdf(d: Pv2ScoreUpdateData, logoPng?: Uint8Array | null): Promise<Buffer> {
  const L = pv2ScoreUpdateL(d.lang);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await pdf.embedPng(logoPng);
    } catch {
      logo = null;
    }
  }
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 792 - 76, width: 612, height: 76, color: PV2.navy });
  page.drawRectangle({ x: 0, y: 792 - 79, width: 612, height: 3, color: PV2.gold });
  let tx = 40;
  if (logo) {
    const h = 38;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: 40, y: 792 - 76 + 19, width: w, height: h });
    tx = 40 + w + 14;
  }
  const p = new Pv2Page(page, font, bold, mono);
  p.text(L.brand, tx, 792 - 28, 9, bold, PV2.gold);
  p.text(L.title, tx, 792 - 44, 13, bold, PV2.white);
  p.text(L.preparedFor(d.clientName, d.baselineDate, d.currentDate), tx, 792 - 60, 8.5, font, rgb(0.85, 0.87, 0.92));
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 36, color: PV2.light });
  p.text(`Optimum Financial Group  |  ${d.phone}  |  ${d.site}${d.address ? `  |  ${d.address}` : ""}`, 40, 15, 7.5, font, PV2.muted);
  p.text(L.page, 612 - 40 - font.widthOfTextAtSize(L.page, 7.5), 15, 7.5, font, PV2.muted);

  const delta = (b: number | null, a: number | null) => (b === null || a === null ? "--" : `${a - b >= 0 ? "+" : ""}${a - b}`);
  // A middle score needs all three bureaus on that report.
  const mid = (k: "before" | "after") => (BUREAUS.every((b) => d.scores[b][k] !== null) ? pv2MiddleScore({ TU: d.scores.TU[k], EX: d.scores.EX[k], EQ: d.scores.EQ[k] }) : null);
  const mb = mid("before");
  const ma = mid("after");

  p.heading(L.scores);
  p.para(L.intro(d.clientFirstName, d.round));
  p.table(
    [L.bureau, L.baseline(d.baselineDate), L.current(d.currentDate), L.change],
    [
      ...BUREAUS.map((b) => [BUREAU_FULL[b], String(d.scores[b].before ?? L.noScore), String(d.scores[b].after ?? L.noScore), delta(d.scores[b].before, d.scores[b].after)]),
      [L.middle, String(mb ?? "--"), String(ma ?? "--"), `${delta(mb, ma)} ${L.pts}`],
    ],
    [0.28, 0.25, 0.25, 0.22],
    8.5,
    true,
  );
  for (const b of BUREAUS) {
    const s = d.scores[b];
    p.text(`${(BUREAU_FULL[b] + ":").padEnd(12)} ${pv2AsciiBar(s.after)} ${s.before ?? L.noScore} -> ${s.after ?? L.noScore} (${delta(s.before, s.after)} ${L.pts})`, p.M, p.y, 8.5, mono, PV2.navy);
    p.y -= 12;
  }
  p.y -= 10;

  p.heading(L.inquiries);
  const shown = BUREAUS.filter((b) => d.inquiries.counts[b].before !== null && d.inquiries.counts[b].after !== null);
  if (shown.length) {
    p.table(
      [L.bureau, L.baseline(d.baselineDate), L.current(d.currentDate), L.change],
      shown.map((b) => {
        const c = d.inquiries.counts[b];
        return [BUREAU_FULL[b], String(c.before), String(c.after), delta(c.before, c.after)];
      }),
      [0.28, 0.25, 0.25, 0.22],
      8.5,
    );
    p.para(L.inquiriesNote, 8, PV2.muted);
  } else {
    p.para(L.inquiriesNone, 9, PV2.muted);
  }
  if (d.inquiries.verified && d.inquiries.removed.length) {
    p.heading(L.removedHeading);
    p.table(
      [L.item, L.bureaus],
      d.inquiries.removed.slice(0, 14).map((w) => [w.item, w.bureaus.join(" / ")]),
      [0.7, 0.3],
      8,
    );
  }
  p.y -= 4;
  p.callout(L.next, L.nextBody);
  return Buffer.from(await pdf.save());
}
