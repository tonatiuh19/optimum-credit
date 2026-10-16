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
}

export interface CreditInquiry {
  date: string;
  creditor: string;
  bureau: Bureau;
  /** SmartCredit groups inquiries by whether a matching account exists. */
  matchedAccount: boolean | null;
}

/** Personal-info difference between bureaus (never carries SSN digits). */
export interface IdentityFlag {
  bureau: Bureau;
  field: "name" | "ssn" | "dob" | "address";
  detail: string;
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

const SC_DAYS_LATE =
  /TransUnion\s+30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)\s*\t?\s*Experian\s*\t?\s*30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)\s*\t?\s*Equifax\s*\t?\s*30:\s*(\S+)\s+60:\s*(\S+)\s+90:\s*(\S+)/;

function lateCount(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** "APPLE CARD/GS BANK USA 110001****" → name + mask. */
function splitScHeader(line: string): { creditor: string; mask: string | null } {
  const m = line.trim().match(/^(.*?)\s+([0-9X*]*\*{2,}[0-9X*]*)$/i);
  return m
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
      cells.every((c) => /^\d{3}$/.test(c) || /^—+$/.test(c)) &&
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
  // "Days Late" rows print once per account, in account order.
  if (daysLate.length === accounts.length) {
    accounts.forEach((account, idx) => {
      const late = daysLate[idx];
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
  } else {
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
      if (
        /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t) &&
        /^(TransUnion|Experian|Equifax)$/.test((lines[i + 2] || "").trim())
      ) {
        const bureauName = lines[i + 2].trim();
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
