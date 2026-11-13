/**
 * OFG Credit File engine — Phase 1: provider parsers → structured CreditFile.
 *
 * Turns extracted credit-report text into account-level data (every tradeline
 * per bureau, inquiries, scores) so the free Credit Analysis and the Progress
 * Report can share one model (analysis = 1 file, progress = Before vs After).
 *
 * Pure + deterministic (no I/O). Production entry remains `api/index.ts`
 * (no runtime sibling imports on Vercel) — inline + add a sync test when wired.
 *
 * Supported layouts:
 *  - SmartCredit 3B ("Ultra 4K 3B Report" print view) — ~93% of uploads
 *  - Equifax "Three Bureau Credit Report" (numbered sections) — see parseEquifax3B
 */

export type Bureau = "TU" | "EX" | "EQ";
export const BUREAUS: Bureau[] = ["TU", "EX", "EQ"];

export type CreditFileProvider = "smartcredit" | "equifax_3b" | "unknown";

/** Normalized per-bureau tradeline fields (null = not reported by that bureau). */
export interface BureauTradeline {
  accountNumber: string | null;
  highBalance: number | null;
  lastVerified: string | null;
  dateLastActivity: string | null;
  dateReported: string | null;
  dateOpened: string | null;
  balance: number | null;
  closedDate: string | null;
  accountRating: string | null;
  description: string | null;
  disputeStatus: string | null;
  creditorType: string | null;
  accountStatus: string | null;
  paymentStatus: string | null;
  remarks: string | null;
  paymentAmount: number | null;
  lastPayment: string | null;
  termLength: string | null;
  pastDue: number | null;
  accountType: string | null;
  paymentFrequency: string | null;
  creditLimit: number | null;
  late30: number | null;
  late60: number | null;
  late90: number | null;
  /**
   * Non-OK payment-grid cells "MM/YYYY:30" (30/60/90/120/150/CO/C/R/F/B).
   * Optional: only Claude extraction fills it.
   */
  gridMarks?: string[];
  /** "Date Last Delinquent" column (tri-merges) — the adverse date, never re-dated by later activity. */
  dateLastDelinquent?: string | null;
}

/** How the report lays accounts out (Spec v2.1). */
export type CreditReportFormat =
  /** One column per bureau (SmartCredit, IdentityIQ, MFSN, myFICO 3B). */
  | "per_bureau"
  /** Lender tri-merge (Factual Data, Xactus, Advantage, CBC): one blended value per field + Repository bureaus. */
  | "merged";

/** The report's own totals (Account Summary) — the self-check gate reconciles against them. */
export interface CreditReportSummary {
  totalAccounts: number | null;
  revolvingAccounts: number | null;
  installmentAccounts: number | null;
  otherAccounts: number | null;
  totalBalance: number | null;
  revolvingBalance: number | null;
  pastDue: number | null;
  late30: number | null;
  late60: number | null;
  late90: number | null;
  /** Lender tri-merge Credit Summary extras (reconcile only, Spec v2.3 §7). */
  revolvingUtilizationPct?: number | null;
  revolvingUsedPct?: number | null;
  collectionsChargeOffs?: number | null;
  inquiries?: number | null;
}

export type AccountSection =
  | "revolving"
  | "installment"
  | "mortgage"
  | "collection"
  | "other"
  | "unknown";

export interface CreditAccount {
  /** Creditor name as printed (e.g. "APPLE CARD/GS BANK USA"). */
  creditor: string;
  /** Masked number from the header (e.g. "110001****"). */
  mask: string | null;
  section: AccountSection;
  /** Header status line (Open / Closed / Paid …). */
  headerStatus: string | null;
  bureaus: Partial<Record<Bureau, BureauTradeline>>;
  /** False when field/value alignment checks failed — staff should verify. */
  confident: boolean;
  /**
   * Merged (tri-merge) row: ONE blended value per field, copied to each
   * Repository bureau — cross-bureau comparisons are meaningless.
   */
  merged?: boolean;
  /** Merged row with no Repository/bureau label: bureaus are "Not itemized". */
  bureausNotItemized?: boolean;
  /** ECOA joint contractual liability (e.g. B-2) — show "(joint)" only. */
  joint?: boolean;
  /** ECOA code as printed (tri-merges: I/A/C/J/M/P/S/T/U/X; "T" = terminated). */
  ecoa?: string | null;
  /** Tri-merge "High Credit" when printed separately from the credit limit. */
  highCredit?: number | null;
  /** Scheduled monthly payment when printed. */
  monthlyPayment?: number | null;
}

export interface CreditInquiry {
  date: string;
  creditor: string;
  /** null = the report does not say which bureau ("Not itemized"). Never guessed. */
  bureau: Bureau | null;
  /** SmartCredit groups inquiries by whether a matching account exists. */
  matchedAccount: boolean | null;
}

/** Personal-info difference between bureaus (never carries SSN digits). */
export interface IdentityFlag {
  /** null = not itemized by bureau on the report. */
  bureau: Bureau | null;
  field: "name" | "ssn" | "dob" | "address";
  detail: string;
  /**
   * v2.4 #4/#7 (set by the analysis, never by the read): unit_mismatch = same street, different unit
   * across bureaus (Round 1); confirm = a prior address to confirm with the client before disputing.
   */
  kind?: "unit_mismatch" | "confirm";
}

export interface CreditFile {
  provider: CreditFileProvider;
  reportDate: string | null;
  scores: Record<Bureau, number | null>;
  /** Rating printed next to each score ("Good", "Very Good" …), if any. */
  scoreRatings?: Record<Bureau, string | null>;
  identityFlags?: IdentityFlag[];
  accounts: CreditAccount[];
  inquiries: CreditInquiry[];
  publicRecordsReported: boolean | null;
  /** Pages with no extractable text (printed as images). */
  imagePages: number;
  totalPages: number;
  /** 0–1: share of pages with readable text (text-skeleton coverage). */
  confidence: number;
  warnings: string[];
  /** Spec v2.1 fields (Claude reader); absent on older reads. */
  reportFormat?: CreditReportFormat;
  /** Full legal name from the Borrower / consumer block. */
  borrowerName?: string | null;
  /** Current address from the Borrower / consumer block (v2.4 #4: never a dispute target). */
  borrowerAddress?: string | null;
  /** Lender that requested a tri-merge (Requested by / Lender header). */
  lender?: {
    name: string | null;
    requestedDate: string | null;
    /** Person / company that ordered the report ("Requested By"). */
    requestedBy?: string | null;
    /** Credit vendor (Xactus, Factual Data …) and its report number. */
    vendor?: string | null;
    reportId?: string | null;
  } | null;
  /** VantageScore per bureau when the report prints it next to FICO. */
  vantageScores?: Record<Bureau, number | null>;
  /** Score reason codes as printed (e.g. "TOO MANY INQUIRIES"). */
  scoreReasonCodes?: string[];
  summary?: CreditReportSummary | null;
  /** Lender simulation (CreditXpert / rapid-rescore) as printed — never our projection. */
  lenderSimulation?: string | null;
  /**
   * Account entries the reader returned before same-account copies were merged
   * (MyFreeScoreNow prints a collection once per bureau section). Compared with
   * the report's own table of contents / account blocks.
   */
  readEntries?: number;
  /** Values corrected from facts the PDF prints (limits, sections, balances, inquiries, lates, a duplicate), for staff. */
  printedRepairs?: string[];
}

// ── shared helpers ──────────────────────────────────────────────────────────

const EMPTY_CELL = /^(——|—|–+|-+|N\/A|NONE REPORTED)?$/i;

export function cellText(raw: string | undefined | null): string | null {
  const t = String(raw ?? "")
    .replace(/®/g, "")
    .trim();
  return EMPTY_CELL.test(t) ? null : t;
}

export function parseMoney(raw: string | null | undefined): number | null {
  const t = cellText(raw);
  if (!t) return null;
  const m = t.replace(/,/g, "").match(/^-?\$?\s*(-?\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : null;
}

function emptyTradeline(): BureauTradeline {
  return {
    accountNumber: null,
    highBalance: null,
    lastVerified: null,
    dateLastActivity: null,
    dateReported: null,
    dateOpened: null,
    balance: null,
    closedDate: null,
    accountRating: null,
    description: null,
    disputeStatus: null,
    creditorType: null,
    accountStatus: null,
    paymentStatus: null,
    remarks: null,
    paymentAmount: null,
    lastPayment: null,
    termLength: null,
    pastDue: null,
    accountType: null,
    paymentFrequency: null,
    creditLimit: null,
    late30: null,
    late60: null,
    late90: null,
  };
}

export function detectCreditFileProvider(text: string): CreditFileProvider {
  if (/smartcredit\.com|Ultra 4K 3B Report/i.test(text)) return "smartcredit";
  if (/Three Bureau Credit Report powered by Equifax/i.test(text)) {
    return "equifax_3b";
  }
  return "unknown";
}

export function parseCreditFile(text: string): CreditFile {
  const provider = detectCreditFileProvider(text);
  if (provider === "smartcredit") return parseSmartCredit(text);
  return {
    provider,
    reportDate: null,
    scores: { TU: null, EX: null, EQ: null },
    accounts: [],
    inquiries: [],
    publicRecordsReported: null,
    imagePages: 0,
    totalPages: 0,
    confidence: 0,
    warnings: [`No account-level parser for provider "${provider}" yet`],
  };
}

// ── SmartCredit 3B ──────────────────────────────────────────────────────────

/** SmartCredit field label → BureauTradeline key + value kind. */
const SC_LABELS: Record<
  string,
  { key: keyof BureauTradeline; kind: "text" | "money" | "date" }
> = {
  "Account Number": { key: "accountNumber", kind: "text" },
  "High Balance": { key: "highBalance", kind: "money" },
  "Last Verified": { key: "lastVerified", kind: "date" },
  "Date of Last Activity": { key: "dateLastActivity", kind: "date" },
  "Date Reported": { key: "dateReported", kind: "date" },
  "Date Opened": { key: "dateOpened", kind: "date" },
  "Balance Owed": { key: "balance", kind: "money" },
  "Closed Date": { key: "closedDate", kind: "date" },
  "Account Rating": { key: "accountRating", kind: "text" },
  "Account Description": { key: "description", kind: "text" },
  "Dispute Status": { key: "disputeStatus", kind: "text" },
  "Creditor Type": { key: "creditorType", kind: "text" },
  "Account Status": { key: "accountStatus", kind: "text" },
  "Payment Status": { key: "paymentStatus", kind: "text" },
  "Creditor Remarks": { key: "remarks", kind: "text" },
  "Payment Amount": { key: "paymentAmount", kind: "money" },
  "Last Payment": { key: "lastPayment", kind: "date" },
  "Term Length": { key: "termLength", kind: "text" },
  "Past Due Amount": { key: "pastDue", kind: "money" },
  "Account Type": { key: "accountType", kind: "text" },
  "Payment Frequency": { key: "paymentFrequency", kind: "text" },
  "Credit Limit": { key: "creditLimit", kind: "money" },
  Utilization: { key: "creditLimit", kind: "text" }, // derived — skipped below
};

const SC_SECTION: Record<string, AccountSection> = {
  "Revolving Accounts": "revolving",
  "Installment Accounts": "installment",
  "Mortgage Accounts": "mortgage",
  "Collections Accounts": "collection",
  "Other Accounts": "other",
  // Lines of credit print in their own section; SmartCredit's utilization table leaves them out.
  "Line of Credit Accounts": "other",
  "Unknown Accounts": "unknown",
};

/** Status lines printed between the creditor header and its labels. */
const SC_STATUS_LINE =
  /^(Open|Closed|Paid|Negative|Derogatory|Collection|Charge.?off|Transferred|Unknown|In Dispute|Closed On\b|Last Payment:|\d+% Credit Utilization)/i;

function isScNoise(line: string): boolean {
  const t = line.trim();
  return (
    !t ||
    /^®(\s*\t?\s*®)*$/.test(t) ||
    /^-- \d+ of \d+ --$/.test(t) ||
    /smartcredit\.com/i.test(t) ||
    /Ultra 4K 3B Report/i.test(t) ||
    /^\d{1,2}\/\d{1,2}\/\d{2},? \d{1,2}:\d{2}/.test(t)
  );
}

/** Three tab-separated bureau cells (TU, EX, EQ). */
function splitScValueRow(line: string): string[] | null {
  if (!line.includes("\t")) return null;
  const cells = line.split("\t").map((c) => c.trim());
  if (cells.length !== 3) return null;
  if (cells.some((c) => /®|^TransUnion|^Experian|^Equifax/.test(c))) {
    return null;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{2},? \d/.test(cells[0])) return null; // page footer
  return cells;
}

// Bureau names may carry ® ("TransUnion® 30: 0 …" in the Ultra 4K 3B print).
const SC_DAYS_LATE =
  /TransUnion®?\s+30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)\s*\t?\s*Experian®?\s*\t?\s*30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)\s*\t?\s*Equifax®?\s*\t?\s*30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)/;

function lateCount(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** "APPLE CARD/GS BANK USA 110001****" → name + mask. Masks can carry letters ("KLARNA QZ6S****", "TILT LN5BNO****"). */
function splitScHeader(line: string): { creditor: string; mask: string | null } {
  const m = line.trim().match(/^(.*?)\s+([0-9A-Z]*\*{2,}[0-9A-Z*]*)$/i);
  return m && m[1].trim()
    ? { creditor: m[1].trim(), mask: m[2] }
    : { creditor: line.trim(), mask: null };
}

export function parseSmartCredit(text: string): CreditFile {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];

  // Scores: first row of three 3-digit numbers (or ——).
  const scores: Record<Bureau, number | null> = { TU: null, EX: null, EQ: null };
  for (const line of lines) {
    const cells = line.split(/\t|\s{2,}|\s(?=\d{3}\b|——)/).map((c) => c.trim()).filter(Boolean);
    if (
      cells.length === 3 &&
      // A lone 0 is how some reports print "no score" (→ null below, column kept).
      cells.every((c) => /^\d{3}$/.test(c) || /^—+$/.test(c) || c === "0") &&
      cells.some((c) => /^\d{3}$/.test(c))
    ) {
      BUREAUS.forEach((b, i) => {
        const n = Number(cells[i]);
        scores[b] = n >= 300 && n <= 850 ? n : null;
      });
      break;
    }
  }

  // Report date: first MM/DD/YYYY ×3 row after "Credit Report Date".
  let reportDate: string | null = null;
  const dateRow = lines.find((l) => {
    const c = splitScValueRow(l);
    return !!c && c.every((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x));
  });
  if (dateRow) reportDate = splitScValueRow(dateRow)![0];

  // Account region: first section header → public-records section.
  const start = lines.findIndex((l) => SC_SECTION[l.trim()] !== undefined);
  let end = lines.findIndex(
    (l, i) =>
      i > start &&
      l.trim() === "Public Records" &&
      /overview of your public records/i.test(lines[i + 1] || ""),
  );
  if (end < 0) end = lines.length;

  // De-noised view (drops page footers / ® markers) so a header at the bottom
  // of one page still sees its labels at the top of the next.
  const region = lines
    .slice(Math.max(start, 0), end)
    .map((l) => l.trim())
    .filter((t) => !isScNoise(t));

  const accounts: CreditAccount[] = [];
  const daysLate: string[][] = [];
  /** Account each Days Late row printed under (the last header before it). */
  const daysLateOwner: number[] = [];
  let section: AccountSection = "unknown";
  for (let i = 0; i < region.length; i++) {
    const t = region[i];
    if (SC_SECTION[t]) {
      section = SC_SECTION[t];
      continue;
    }
    const late = t.match(SC_DAYS_LATE);
    if (late) {
      daysLate.push(late.slice(1));
      daysLateOwner.push(accounts.length - 1);
      continue;
    }
    // Header: creditor line, 1–4 status lines, then the "Account Number" label.
    const anIdx = region
      .slice(i + 1, i + 6)
      .findIndex((l) => l === "Account Number");
    if (
      anIdx >= 1 &&
      !t.includes("\t") &&
      !SC_LABELS[t] &&
      region.slice(i + 1, i + 1 + anIdx).every((l) => SC_STATUS_LINE.test(l))
    ) {
      const { creditor, mask } = splitScHeader(t);
      accounts.push({
        creditor,
        mask,
        section,
        headerStatus: region.slice(i + 1, i + 1 + anIdx).join(" · "),
        bureaus: {},
        // Field values are not aligned from text (page splits make it
        // unreliable) — Claude extraction fills them; this is the skeleton.
        confident: true,
      });
      i += anIdx + 1; // skip status lines + this header's "Account Number"
      continue;
    }
    // Labels with no readable header: the creditor line was on an image page.
    if (t === "Account Number") {
      accounts.push({
        creditor: "(unreadable — header on image page)",
        mask: null,
        section,
        headerStatus: null,
        bureaus: {},
        confident: false,
      });
    }
  }
  // "Days Late" rows print once per account, after that account's header. Same count → account order;
  // otherwise (an extra / image header — Nov 6, 2026: 96 rows for 97 headers) each row goes to the header
  // printed before it, and an account that would get two rows gets none (never guessed).
  const lateFor = new Map<number, string[]>();
  if (daysLate.length === accounts.length) daysLate.forEach((row, idx) => lateFor.set(idx, row));
  else {
    const seen = new Map<number, number>();
    daysLateOwner.forEach((owner) => seen.set(owner, (seen.get(owner) ?? 0) + 1));
    daysLate.forEach((row, idx) => {
      const owner = daysLateOwner[idx];
      if (owner >= 0 && seen.get(owner) === 1) lateFor.set(owner, row);
    });
  }
  if (lateFor.size) {
    accounts.forEach((account, idx) => {
      const late = lateFor.get(idx);
      if (!late) return;
      BUREAUS.forEach((b, bi) => {
        const l30 = lateCount(late[bi * 3]);
        const l60 = lateCount(late[bi * 3 + 1]);
        const l90 = lateCount(late[bi * 3 + 2]);
        if (l30 === null && l60 === null && l90 === null) return;
        account.bureaus[b] = {
          ...emptyTradeline(),
          late30: l30,
          late60: l60,
          late90: l90,
        };
      });
    });
  }
  if (daysLate.length !== accounts.length) {
    warnings.push(
      `SmartCredit days-late rows (${daysLate.length}) ≠ accounts (${accounts.length})`,
    );
  }

  // Image-only pages: text pages vs total pages (accounts may be missing).
  const pageMarkers = text.match(/^-- \d+ of (\d+) --$/gm) || [];
  const totalPages = pageMarkers.length;
  // Chunks before each "-- n of N --" marker (drop the trailing remainder).
  const pageTexts = text.split(/^-- \d+ of \d+ --$/m).slice(0, totalPages);
  const imagePages = pageTexts.filter(
    (pt) =>
      pt
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => !isScNoise(l)).length <= 3,
  ).length;
  const textOnlyPages = Math.max(0, Math.min(totalPages, imagePages));

  // Inquiries: date / creditor / bureau triples after "Inquiries N".
  const inquiries: CreditInquiry[] = [];
  const inqStart = lines.findIndex((l) => /^Inquiries \d+$/.test(l.trim()));
  if (inqStart >= 0) {
    let matched: boolean | null = null;
    for (let i = inqStart + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^Creditor Contacts\b/.test(t)) break;
      if (/have matching accounts/i.test(t)) matched = true;
      if (/no matching account/i.test(t)) matched = false;
      // Nov 12, 2026: SmartCredit prints "TransUnion®" / "Experian®" / "Equifax®" here. The exact-name
      // match read ZERO inquiries from every such PDF, so the printed-inquiries repair never had a list.
      const bureauCell = /^(TransUnion|Experian|Equifax)\W*$/.exec((lines[i + 2] || "").trim());
      // Dates print as "6/1/2026" or (newer layout) "Jun 01, 2026".
      if ((/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t) || /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(t)) && bureauCell) {
        const bureauName = bureauCell[1];
        inquiries.push({
          date: t,
          creditor: lines[i + 1].trim(),
          bureau:
            bureauName === "TransUnion" ? "TU" : bureauName === "Experian" ? "EX" : "EQ",
          matchedAccount: matched,
        });
        i += 2;
      }
    }
  }

  const prIdx = end < lines.length ? end : -1;
  const publicRecordsReported =
    prIdx >= 0
      ? !/^None Reported$/i.test(
          lines
            .slice(prIdx + 1, prIdx + 6)
            .map((l) => l.trim())
            .find((l) => /^None Reported$/i.test(l)) || "",
        )
      : null;

  if (accounts.length === 0) warnings.push("SmartCredit: no accounts found");
  if (textOnlyPages > 0) {
    warnings.push(
      `${textOnlyPages} of ${totalPages} page(s) have no text (printed as images) — accounts on those pages are not in the text`,
    );
  }
  return {
    provider: "smartcredit",
    reportDate,
    scores,
    accounts,
    inquiries,
    publicRecordsReported,
    imagePages: textOnlyPages,
    totalPages,
    confidence:
      totalPages > 0 ? (totalPages - textOnlyPages) / totalPages : accounts.length ? 1 : 0,
    warnings,
  };
}

/** One account as the SmartCredit print shows it: its section and Credit Limit row (bureaus printing "——" are left out). */
export interface ScPrintedLimit {
  creditor: string;
  mask: string;
  limits: Partial<Record<Bureau, number>>;
  /** Balance Owed row (validated against the Date Opened row above it). */
  balances?: Partial<Record<Bureau, number>>;
  /** Date Opened row (MM/DD/YYYY): tells look-alike accounts with one number apart. */
  opened?: Partial<Record<Bureau, string>>;
  /** "Days Late - Last 7 Years" per bureau (bureaus printing "––" are left out). */
  lates?: Partial<Record<Bureau, { late30: number | null; late60: number | null; late90: number | null }>>;
  /** Section the account is printed under (Revolving Accounts, Installment Accounts, …). */
  section?: AccountSection;
}

const SC_GROUP_HEADER = /^TransUnion®?\s*\tExperian®?\s*\tEquifax®?$/;
const SC_GRID_CELL = /^(30|60|90|120|150|180|CO|C|R|F|B|OK)$/;
const SC_DASH = /^[—–-]+$/;

// ── MyFreeScoreNow (Three Bureau Credit Report) printed account facts ─────────

const MF_BUREAUS: Bureau[] = ["EQ", "EX", "TU"]; // column order in every MyFreeScoreNow table
const MF_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "$1,250 N/A $1,250" → per bureau (EQ, EX, TU). Null when the row is not three values. */
function mfMoneyRow(rest: string): Partial<Record<Bureau, number>> | null {
  const cells = rest.trim().split(/\s+/);
  if (cells.length !== 3 || !cells.every((c) => /^\$[\d,]+(\.\d{2})?$/.test(c) || /^(N\/A|—+|-+)$/i.test(c))) return null;
  const out: Partial<Record<Bureau, number>> = {};
  cells.forEach((c, i) => {
    if (c.startsWith("$")) out[MF_BUREAUS[i]] = Number(c.replace(/[$,]/g, ""));
  });
  return out;
}

/** "1 0 N/A" → per bureau counts. */
function mfCountRow(rest: string): Partial<Record<Bureau, number>> | null {
  const cells = rest.trim().split(/\s+/);
  if (cells.length !== 3 || !cells.every((c) => /^\d+$/.test(c) || /^N\/A$/i.test(c))) return null;
  const out: Partial<Record<Bureau, number>> = {};
  cells.forEach((c, i) => {
    if (/^\d+$/.test(c)) out[MF_BUREAUS[i]] = Number(c);
  });
  return out;
}

/** "May 01, 2025 N/A Mar 01, 2026" → per bureau MM/DD/YYYY. */
function mfDateRow(rest: string): Partial<Record<Bureau, string>> | null {
  const cells = [...rest.matchAll(/([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})|N\/A/g)];
  if (cells.length !== 3) return null;
  const out: Partial<Record<Bureau, string>> = {};
  cells.forEach((m, i) => {
    const mi = m[1] ? MF_MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (mi >= 0) out[MF_BUREAUS[i]] = `${String(mi + 1).padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  });
  return out;
}

const MF_SECTION: Record<string, AccountSection> = { revolving: "revolving", mortgage: "mortgage", installment: "installment", other: "other", collection: "collection", collections: "collection" };

/**
 * Account facts a MyFreeScoreNow report prints for each account (Nov 6, 2026), in the same shape as
 * the SmartCredit ones so every guarded repair applies: credit limit, reported balance, date opened,
 * 30/60/90+ days past due (7-year Payment Summary) and the section. Each account block starts with
 * its numbered heading ("2.1 Credit One Bank (CLOSED)", after the table of contents) and prints
 * label-led rows with Equifax, Experian, TransUnion columns.
 */
export function parseMfsnPrintedAccounts(text: string): ScPrintedLimit[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sections = new Map<string, AccountSection>();
  let lastToc = -1;
  lines.forEach((l, i) => {
    const sec = /^(\d+)\. (Revolving|Mortgage|Installment|Other|Collections?) Accounts \d+$/i.exec(l);
    if (sec) sections.set(sec[1], MF_SECTION[sec[2].toLowerCase()] ?? "other");
    if (/^\d+\.\d+ \S.* \d+$/.test(l) && sections.size) lastToc = i;
  });
  if (!sections.size) return [];
  const out: ScPrintedLimit[] = [];
  let cur: (ScPrintedLimit & { done: Set<string>; lastDigits: string[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    const { done, lastDigits, ...entry } = cur;
    if (lastDigits.length) out.push({ ...entry, mask: [...new Set(lastDigits)].join(" ") });
    cur = null;
  };
  for (let i = lastToc + 1; i < lines.length; i++) {
    const l = lines[i];
    const head = /^(\d+)\.(\d+) (.+?)(?: \((?:CLOSED|OPEN)\))?$/i.exec(l);
    if (head && sections.has(head[1])) {
      flush();
      cur = { creditor: head[3].trim(), mask: "", limits: {}, section: sections.get(head[1]), done: new Set(), lastDigits: [] };
      continue;
    }
    if (!cur) continue;
    const c = cur as ScPrintedLimit & { done: Set<string>; lastDigits: string[] };
    const take = (label: string) => {
      if (!l.startsWith(`${label} `) || c.done.has(label)) return null;
      c.done.add(label);
      return l.slice(label.length + 1);
    };
    let rest: string | null;
    if ((rest = take("Account Number")) !== null) {
      for (const m of rest.matchAll(/[xX*]+ ?([0-9A-Z]{2,})/g)) c.lastDigits.push(m[1]);
    } else if ((rest = take("Credit Limit")) !== null) {
      c.limits = mfMoneyRow(rest) ?? {};
    } else if ((rest = take("Reported Balance")) !== null) {
      const v = mfMoneyRow(rest);
      if (v && Object.keys(v).length) c.balances = v;
    } else if ((rest = take("Date Opened")) !== null) {
      const v = mfDateRow(rest);
      if (v && Object.keys(v).length) c.opened = v;
    } else {
      // Same meaning as the read's late_30/60/90 for this layout: the 30, 60 and 90 Days Past Due rows
      // (120+ prints as its own row and stays out, so a repair never changes what "x90" means).
      for (const [label, field] of [["30 Days Past Due", "late30"], ["60 Days Past Due", "late60"], ["90 Days Past Due", "late90"]] as const) {
        if ((rest = take(label)) === null) continue;
        const v = mfCountRow(rest);
        if (!v) continue;
        c.lates ??= {};
        for (const b of MF_BUREAUS) {
          if (v[b] == null) continue;
          const t = (c.lates[b] ??= { late30: null, late60: null, late90: null });
          t[field] = v[b]!;
        }
      }
    }
  }
  flush();
  return out;
}

/**
 * Credit limits read straight from the text of a SmartCredit 3B print (Nov 6, 2026 — a client:
 * the account read took the High Balance row as the limit, so revolving limits never matched
 * the report's own Credit Utilization total and every round was held).
 *
 * Each account prints its labels, then a value block that starts with the
 * "TransUnion® Experian® Equifax®" row and the account-number row. A page break can move the
 * rest of a block below the next account's labels, but blocks keep account order, so every
 * value row up to the next block belongs to the current one. Credit Limit is the last label
 * (Utilization follows it on open revolving accounts). Blocks are matched to account headers
 * by their mask; an account whose header or values are not in the text is left out.
 */
export function parseSmartCreditPrintedLimits(text: string): ScPrintedLimit[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => SC_SECTION[l.trim()] !== undefined);
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && l.trim() === "Public Records" && /overview of your public records/i.test(lines[i + 1] || ""));
  if (end < 0) end = lines.length;
  const region = lines.slice(start, end).map((l) => l.trim()).filter((t) => !isScNoise(t));

  const heads: Array<{ creditor: string; mask: string | null; utilization: boolean; section: AccountSection | null; labels: string[]; late: string[][] }> = [];
  // null until a section heading is printed ("Unknown Accounts" is a real section: SmartCredit's
  // utilization total leaves it out, so it must not read as "no section").
  let section: AccountSection | null = null;
  /** Labels print as one run right after the header: they give each value row its meaning. */
  let collecting = false;
  const blocks: Array<{ masks: string[]; rows: string[][] }> = [];
  let block: { masks: string[]; rows: string[][] } | null = null;
  for (let i = 0; i < region.length; i++) {
    const t = region[i];
    if (SC_SECTION[t]) {
      section = SC_SECTION[t];
      continue;
    }
    const anIdx = region.slice(i + 1, i + 6).findIndex((l) => l === "Account Number");
    if (anIdx >= 1 && !t.includes("\t") && !SC_LABELS[t] && region.slice(i + 1, i + 1 + anIdx).every((l) => SC_STATUS_LINE.test(l))) {
      // Account numbers can carry letters (BNPL / loans: "TILT LN5BNO****"): the last token is the mask when masked.
      const token = t.split(/\s+/).pop() || "";
      const masked = token.includes("*") && t.length > token.length;
      heads.push({ creditor: masked ? t.slice(0, -token.length).trim() : splitScHeader(t).creditor, mask: masked ? token : null, utilization: false, section, labels: ["Account Number"], late: [] });
      collecting = true;
      i += anIdx + 1;
      continue;
    }
    if (t === "Account Number") {
      heads.push({ creditor: "", mask: null, utilization: false, section, labels: ["Account Number"], late: [] }); // header on an image page
      collecting = true;
      continue;
    }
    if (collecting && SC_LABELS[t] && heads.length) heads[heads.length - 1].labels.push(t);
    else collecting = false;
    // Days Late prints after its own account's details (the last header before it).
    const lateRow = t.match(SC_DAYS_LATE);
    if (lateRow && heads.length) heads[heads.length - 1].late.push(lateRow.slice(1));
    if (t === "Utilization" && heads.length) heads[heads.length - 1].utilization = true;
    if (SC_GROUP_HEADER.test(t)) {
      const masks = splitScValueRow(region[i + 1] || "");
      block = null;
      if (masks && masks.some((m) => m.includes("*")) && masks.every((m) => m.includes("*") || SC_DASH.test(m))) {
        block = { masks, rows: [] };
        blocks.push(block);
        i++;
      }
      continue;
    }
    // A label can print on its own value line ("Balance Owed \t$1,036 \t$1,036 \t$1,032"): keep the values.
    const parts = t.split("\t").map((c) => c.trim());
    const cells = splitScValueRow(t) ?? (parts.length === 4 && SC_LABELS[parts[0]] ? splitScValueRow(parts.slice(1).join("\t")) : null);
    // Payment-grid rows ("30 30 30") can print between the two halves of a split block.
    if (cells && block && !cells.every((c) => SC_GRID_CELL.test(c))) block.rows.push(cells);
  }

  const out: ScPrintedLimit[] = [];
  let next = 0;
  for (const h of heads) {
    if (!h.mask || !h.creditor) continue;
    // Next block (within a short window) printing this header's mask; skipped blocks belong to unreadable headers.
    let k = -1;
    for (let j = next; j < Math.min(next + 3, blocks.length); j++) {
      if (blocks[j].masks.includes(h.mask)) {
        k = j;
        break;
      }
    }
    if (k < 0) continue;
    next = k + 1;
    const rows = blocks[k].rows;
    const last = rows[rows.length - 1];
    const limits: Partial<Record<Bureau, number>> = {};
    if (last) {
      const utilRow = last.some((c) => /%$/.test(c)) || (h.utilization && last.every((c) => SC_DASH.test(c)));
      const row = utilRow ? rows[rows.length - 2] : last;
      if (row && row.every((c) => /^\$[\d,]+(\.\d{2})?$/.test(c) || SC_DASH.test(c))) {
        BUREAUS.forEach((b, bi) => {
          if (/^\$/.test(row[bi])) limits[b] = Number(row[bi].replace(/[$,]/g, ""));
        });
      }
    }
    // Balance Owed by the block's shape (labels can be cut by a page break or left out): an optional
    // High Balance row, then 3-4 date rows (last verified, last activity, reported, opened), then the balance.
    const balances: Partial<Record<Bureau, number>> = {};
    const isMoney = (r: string[]) => r.every((c) => /^\$[\d,]+(\.\d{2})?$/.test(c) || SC_DASH.test(c)) && r.some((c) => /^\$/.test(c));
    const isDate = (r: string[]) => r.every((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c) || SC_DASH.test(c)) && r.some((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
    let at = rows[0] && isMoney(rows[0]) ? 1 : 0;
    const dateStart = at;
    while (rows[at] && isDate(rows[at])) at++;
    const dateRows = at - dateStart;
    const balRow = rows[at];
    const opened: Partial<Record<Bureau, string>> = {};
    if (dateRows >= 3 && dateRows <= 4 && balRow && isMoney(balRow)) {
      BUREAUS.forEach((b, bi) => {
        if (/^\$/.test(balRow[bi])) balances[b] = Number(balRow[bi].replace(/[$,]/g, ""));
        if (/^\d/.test(rows[at - 1][bi])) opened[b] = rows[at - 1][bi];
      });
    }
    // One Days Late row per account; two under one header means the text is ambiguous → none.
    const lates: NonNullable<ScPrintedLimit["lates"]> = {};
    if (h.late.length === 1) {
      const row = h.late[0];
      BUREAUS.forEach((b, bi) => {
        const l30 = lateCount(row[bi * 3]);
        const l60 = lateCount(row[bi * 3 + 1]);
        const l90 = lateCount(row[bi * 3 + 2]);
        if (l30 !== null || l60 !== null || l90 !== null) lates[b] = { late30: l30, late60: l60, late90: l90 };
      });
    }
    out.push({
      creditor: h.creditor,
      mask: h.mask,
      limits,
      ...(Object.keys(lates).length ? { lates } : {}),
      ...(Object.keys(balances).length ? { balances } : {}),
      ...(Object.keys(opened).length ? { opened } : {}),
      ...(h.section ? { section: h.section } : {}),
    });
  }
  return out;
}

