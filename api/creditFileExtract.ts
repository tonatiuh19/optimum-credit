/**
 * OFG Credit File engine — Claude extraction (lean fields) + cross-check.
 *
 * Claude reads the credit-report PDF (incl. pages printed as images — ~77% of
 * SmartCredit uploads) and returns account-level data through structured
 * outputs (JSON schema). Only the fields the Analysis / Progress reports use
 * are requested: output size drives latency, so lean = faster + cheaper.
 *
 * Runs as a background job (Message Batches via the queue cron) because a
 * full report takes ~1–3 min, over the 60s Vercel function limit.
 *
 * Pure (no I/O). Production entry remains api/index.ts (inline + sync test
 * when wired). The text parser (creditFile.ts) supplies the cross-check.
 */
import {
  BUREAUS,
  type AccountSection,
  type Bureau,
  type BureauTradeline,
  type CreditAccount,
  type CreditFile,
  type CreditFileProvider,
  type CreditInquiry,
  type CreditReportSummary,
} from "./creditFile";

const BUREAU_KEYS = { TU: "transunion", EX: "experian", EQ: "equifax" } as const;

/**
 * Structured outputs limit: max 16 nullable/union fields per schema, and the
 * grammar must stay small. So: every scalar is a plain STRING ("" = not
 * reported / blank — the parser maps "" to null and numeric strings to
 * numbers), and per-bureau data is ONE tradeline schema in a list tagged with
 * its bureau (not three copies). Keep it that way — union types here broke
 * every extraction ("compiled grammar is too large").
 */
const STR = { type: "string" } as const;
// Enums blow up the compiled grammar ("too large") — plain strings with the
// allowed values in the description; the parser maps anything else to null.
const BUREAU_ENUM = { type: "string", description: "transunion | experian | equifax" } as const;
/** Inquiries / identity rows: "not_itemized" when the report does not name the bureau — never guess. */
const BUREAU_OR_NONE = { type: "string", description: "transunion | experian | equifax | not_itemized" } as const;

/** One bureau's view of an account (only bureaus that report it). */
const TRADELINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bureau: BUREAU_ENUM,
    date_opened: { ...STR, description: "As printed (MM/DD/YYYY, MM/YYYY or YYYY-MM-DD)" },
    date_last_activity: { ...STR, description: "Date Last Activity column ONLY — never the Date Reported" },
    date_reported: { ...STR, description: "Date Reported column" },
    date_last_delinquent: { ...STR, description: 'Date Last Delinquent / Date of First Delinquency / Date of Major Delinquency if printed; "" otherwise' },
    closed_date: { ...STR, description: "Closed date if this bureau prints one" },
    balance: { ...STR, description: "Plain number, no $ or commas" },
    credit_limit: { ...STR, description: "Credit limit (revolving) or High Credit / original amount (loans, leases)" },
    past_due: STR,
    account_type: { ...STR, description: "e.g. Credit Card, Auto Loan, Collection, Installment" },
    account_status: { ...STR, description: "Open / Closed / Paid / Derogatory …" },
    payment_status: { ...STR, description: "Current, Late 30 Days, Charge-off, Collection …" },
    remarks: { ...STR, description: "Creditor remarks verbatim, incl. any dispute notation and any 'LAST REPORTED DELINQUENCIES: MM/YYYY=XN' line; never the creditor address / phone column" },
    dispute_status: STR,
    late_30: STR,
    late_60: STR,
    late_90: STR,
    payment_grid_lates: {
      type: "array",
      items: STR,
      description: 'Every NON-OK cell of this bureau\'s payment-history grid as "MM/YYYY:CODE" (CODE = 30, 60, 90, 120, 150, CO, C, R, F, B). Empty when all cells are OK/blank.',
    },
  },
  required: [
    "bureau",
    "date_opened",
    "date_last_activity",
    "date_reported",
    "date_last_delinquent",
    "closed_date",
    "balance",
    "credit_limit",
    "past_due",
    "account_type",
    "account_status",
    "payment_status",
    "remarks",
    "dispute_status",
    "late_30",
    "late_60",
    "late_90",
    "payment_grid_lates",
  ],
} as const;

const PER_BUREAU_STR = {
  type: "object",
  additionalProperties: false,
  properties: { transunion: STR, experian: STR, equifax: STR },
  required: ["transunion", "experian", "equifax"],
} as const;

/** JSON schema for structured outputs (output_config.format). */
/** One string keeps the grammar small; parsed by parseSummaryText. */
const SUMMARY_SCHEMA = {
  type: "string",
  description:
    'The report\'s OWN Account Summary totals as "key=value" pairs separated by ";" — keys: total_accounts, revolving_accounts, installment_accounts, other_accounts, total_balance, revolving_balance, past_due, late_30, late_60, late_90, revolving_utilization_pct, revolving_used_pct, collections_chargeoffs, inquiries. Only totals the report prints. "" if no summary.',
} as const;

/** One account (shared by the read and the "find missing accounts" pass). */
const ACCOUNT_ITEM_SCHEMA = {
        type: "object",
        additionalProperties: false,
        properties: {
          creditor: STR,
          original_creditor: STR,
          account_mask: { ...STR, description: "Last 4 only" },
          repository: {
            ...STR,
            description:
              'Merged reports: the repository / bureau code printed for THIS account, copied as printed, e.g. "EXP/TUC/EQX", "EQX/TUC", "EQX", "TU,EQ,XP"; "" when not printed. per_bureau reports: ""',
          },
          ecoa: { ...STR, description: 'ECOA / ownership code as printed (e.g. "I", "T", "B-2", "Joint"); "" if not printed' },
          high_credit: { ...STR, description: 'Merged reports: "High Credit" when printed separately from the Credit Limit (stacked cells); plain number; "" otherwise' },
          monthly_payment: { ...STR, description: 'Scheduled monthly payment / Terms amount if printed; plain number; "" otherwise' },
          section: { type: "string", description: "revolving | installment | mortgage | collection | other | unknown" },
          tradelines: { type: "array", items: TRADELINE_SCHEMA },
        },
        required: ["creditor", "original_creditor", "account_mask", "repository", "ecoa", "high_credit", "monthly_payment", "section", "tradelines"],
      } as const;

export const CREDIT_FILE_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    report_date: { ...STR, description: "Credit Report Date printed in the report body (the pull date). NEVER the browser print header/footer date or the day the PDF was saved" },
    report_format: {
      type: "string",
      description:
        "per_bureau = one column per bureau (SmartCredit, IdentityIQ, MyFreeScoreNow, myFICO). merged = lender tri-merge (Factual Data, Xactus, Advantage Credit, CBC, MeridianLink) with ONE row per account and a Repository / source column",
    },
    borrower_name: { ...STR, description: "Full legal name from the Borrower / consumer block (e.g. ALMA YVETTE RICE)" },
    borrower_address: { ...STR, description: "Current address printed in the Borrower / consumer block (street, unit, city, state, ZIP); \"\" if none" },
    lender_name: { ...STR, description: "Lender / client company on a lender tri-merge header (e.g. STATEWIDE); \"\" otherwise" },
    requested_date: { ...STR, description: "Date Requested / Ordered on a lender tri-merge; \"\" otherwise" },
    requested_by: { ...STR, description: "Person printed after 'Requested By' on a lender tri-merge (e.g. Angelina Angeles); \"\" otherwise" },
    credit_vendor: { ...STR, description: "Credit vendor that produced a lender tri-merge (Xactus, Factual Data, Advantage Credit, CBC, MeridianLink); \"\" otherwise" },
    report_id: { ...STR, description: "Report ID / report number on a lender tri-merge; \"\" otherwise" },
    lender_simulation: { ...STR, description: "Lender simulation result as printed (e.g. CreditXpert: no rapid-rescore plan; +20 with $10,000 paydown); \"\" if none" },
    vantage_scores: { ...PER_BUREAU_STR, description: "VantageScore per bureau when printed IN ADDITION to the main score; \"\" otherwise" },
    score_reason_codes: {
      type: "array",
      items: STR,
      description: "Score reason / factor statements as printed (e.g. \"TOO MANY INQUIRIES LAST 12 MONTHS\")",
    },
    summary: SUMMARY_SCHEMA,
    scores: { ...PER_BUREAU_STR, description: "3-digit score per bureau; \"\" if none" },
    score_model: { ...STR, description: "e.g. VantageScore 3.0" },
    score_ratings: {
      ...PER_BUREAU_STR,
      description: "Rating word printed next to each score (e.g. Fair, Good, Very Good, Excellent); \"\" if none printed",
    },
    identity_variations: {
      type: "array",
      description:
        "Personal-information differences between bureaus (name variations, SSN not matching the other bureaus, date of birth, address). NEVER include SSN digits.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          bureau: BUREAU_OR_NONE,
          field: { type: "string", description: "name | ssn | dob | address" },
          detail: { ...STR, description: "Short description, no SSN digits" },
        },
        required: ["bureau", "field", "detail"],
      },
    },
    accounts: { type: "array", items: ACCOUNT_ITEM_SCHEMA },
    inquiries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { date: STR, creditor: STR, bureau: BUREAU_OR_NONE },
        required: ["date", "creditor", "bureau"],
      },
    },
    public_records_count: { ...STR, description: "Number of public records; \"\" if not shown" },
    unreadable_pages: {
      type: "array",
      items: { type: "integer" },
      description: "1-based page numbers you could not read",
    },
  },
  required: [
    "report_date",
    "report_format",
    "borrower_name",
    "borrower_address",
    "lender_name",
    "requested_date", "requested_by", "credit_vendor", "report_id", "lender_simulation",
    "vantage_scores",
    "score_reason_codes",
    "summary",
    "scores",
    "score_model",
    "score_ratings",
    "identity_variations",
    "accounts",
    "inquiries",
    "public_records_count",
    "unreadable_pages",
  ],
} as const;

export const CREDIT_FILE_EXTRACTION_PROMPT = `You are reading a consumer credit report (any provider: SmartCredit, IdentityIQ, MyFreeScoreNow, myFICO, a bureau report, or a lender tri-merge such as Factual Data, Xactus, Advantage Credit, CBC, MeridianLink; a scan or a photo). It may cover one, two or three bureaus (TransUnion, Experian, Equifax). Some pages may be images — read them too.
Extract EVERY tradeline account (open, closed, paid, collections, charge-offs) exactly as printed. One entry per account. Read every account section (Revolving, Mortgage, Installment, Other Accounts, Collections); when the report has a table of contents or summary that lists its accounts, return every listed account.
Report format (report_format):
- per_bureau: the report prints one column per bureau. Add one "tradelines" item for EACH bureau that reports the account; leave a bureau out when it does not report it.
- merged (lender tri-merge): ONE row per account with a Repository / source column. Set "repository" to the bureau code printed for that account, copied as printed (Xactus prints EXP / TUC / EQX in any order, e.g. "EXP/TUC/EQX", "EQX/TUC", "EQX"; others print TU / EQ / XP). Equifax-only accounts exist (EQX alone). Add ONE tradelines item per bureau listed in repository, all with the same values. If no repository is printed for the account, set repository to "" and add ONE tradelines item with bureau "transunion" (it will be treated as not itemized). Never add a bureau that is not printed.
Rules:
- Copy values verbatim; never infer, estimate, or fill missing values. Use "" (empty string) for "——", "--", blank, or not reported.
- Read tables by COLUMN position: Date Reported, Date Last Delinquent, Date Last Activity, Date Opened are different columns. An empty cell stays "" — never shift the next date into it.
- Money as plain numbers (no $ or commas). Dates as printed.
- late_30 / late_60 / late_90 are the 30-59 / 60-89 / 90+ "Days Late" counts for that account/bureau. Accounts with late counts are negative even if the current status says As Agreed.
- remarks: creditor remarks verbatim (keep dispute notations such as "Consumer disputes", "Dispute resolved - consumer disagrees"). Include any "LAST REPORTED DELINQUENCIES: 07/2026=I5, 08/2026=I5" line exactly as printed (month=type+level codes). Take remarks from the Remarks column only: the creditor address / phone column next to it is never part of remarks or the creditor name.
- payment_grid_lates: read the payment-history grid; list every late/derogatory cell as "MM/YYYY:CODE". Empty when the report has no grid.
- borrower_name: full legal name from the Borrower / consumer identification block. borrower_address: the current address printed in that block.
- lender_name / requested_date / requested_by / credit_vendor / report_id: from the tri-merge header (client company, Requested By person, Ordered date, vendor such as Xactus, Report ID).
- Merged tri-merges stack High Credit over Credit Limit in one cell: credit_limit = Credit Limit, high_credit = High Credit (installments: credit_limit = original amount / High Credit). Read stacked cells by column position, never by token order.
- closed_date: the "Closed: MM/YYYY" or "Paid: MM/YYYY" line under the account. Copy the late-date lines ("30-59 Days Late: …", "60-89 Days Late: …", "90+ Days Late: …") into remarks and payment_grid_lates.
- Inquiries on a tri-merge: the "Inquiries" table, bureau from "Reported On" (EXP-B1 = experian, TUC-B1 = transunion, EQX-B1 = equifax), one entry per row (keep duplicates).
- summary: copy the report's own Account Summary / Credit Summary totals (number of accounts by type, total balance, revolving balance, total past due, total 30/60/90 lates; tri-merges also: revolving_utilization_pct, revolving_used_pct, collections_chargeoffs, inquiries). "" for any total the report does not print.
- score_ratings: the rating word printed for each score (do not compute one). vantage_scores only when printed in addition to the main score.
- identity_variations: name variants, SSN mismatch, date of birth, and addresses (incl. non-residential ones) that differ. Addresses: ALWAYS list every address each bureau prints (current and prior), one entry per bureau, with the full street number, unit and complete reported dates — a unit that differs between bureaus for the same street is a variance. bureau = the bureau printed for that variant, or "not_itemized" when the report does not say. Never write SSN digits.
- Inquiries: every hard inquiry, one entry per bureau WHEN the report labels the bureau; otherwise one entry with bureau "not_itemized". A creditor followed by a phone number in a creditor-information section is NOT an inquiry.
- account_mask: last 4 digits only.
- List any page you could not read in unreadable_pages.`;

/**
 * Messages API params for one report (use as Batches `params`).
 * `model` comes from ANTHROPIC_MODEL (caller resolves the default).
 */
/** Credit-report upload types Claude can read (any provider). */
export const CREDIT_FILE_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export type CreditFileMediaType = (typeof CREDIT_FILE_MEDIA_TYPES)[number];

export function isSupportedCreditFileMediaType(
  mime: string,
): mime is CreditFileMediaType {
  return (CREDIT_FILE_MEDIA_TYPES as readonly string[]).includes(mime);
}

export function buildCreditFileExtractionParams(opts: {
  /** Base64 file bytes (PDF or image). */
  fileBase64?: string;
  /** @deprecated use fileBase64 */
  pdfBase64?: string;
  mediaType?: CreditFileMediaType;
  model: string;
  maxTokens?: number;
  /**
   * What the report itself says it contains (e.g. "This report lists 24
   * accounts…"), from its own summary / table of contents — the read must
   * return every one of them.
   */
  accountHint?: string | null;
  /** Split read: which page range of the full report this part covers (replaces accountHint). */
  partNote?: string | null;
}): Record<string, unknown> {
  const data = opts.fileBase64 ?? opts.pdfBase64 ?? "";
  const mediaType = opts.mediaType ?? "application/pdf";
  const fileBlock =
    mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: mediaType, data },
        }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 32000,
    output_config: {
      format: { type: "json_schema", schema: CREDIT_FILE_EXTRACTION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: opts.partNote
              ? `${CREDIT_FILE_EXTRACTION_PROMPT}\n- ${opts.partNote}`
              : opts.accountHint
                ? `${CREDIT_FILE_EXTRACTION_PROMPT}\n- ${opts.accountHint}`
                : CREDIT_FILE_EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  const t = v === null || v === undefined ? "" : String(v).trim();
  return !t || /^(——|—|--|-|N\/A)$/i.test(t) ? null : t;
}

function toTradeline(raw: any): BureauTradeline | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    accountNumber: null,
    highBalance: null,
    lastVerified: null,
    dateLastActivity: str(raw.date_last_activity),
    dateReported: str(raw.date_reported),
    dateLastDelinquent: str(raw.date_last_delinquent),
    dateOpened: str(raw.date_opened),
    balance: num(raw.balance),
    accountRating: null,
    description: null,
    disputeStatus: str(raw.dispute_status),
    creditorType: null,
    accountStatus: str(raw.account_status),
    paymentStatus: str(raw.payment_status),
    remarks: str(raw.remarks),
    paymentAmount: null,
    lastPayment: null,
    termLength: null,
    pastDue: num(raw.past_due),
    accountType: str(raw.account_type),
    paymentFrequency: null,
    creditLimit: num(raw.credit_limit),
    late30: num(raw.late_30),
    late60: num(raw.late_60),
    late90: num(raw.late_90),
    closedDate: str(raw.closed_date),
    gridMarks: Array.isArray(raw.payment_grid_lates)
      ? raw.payment_grid_lates.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 120)
      : [],
  };
}

const SECTIONS: AccountSection[] = [
  "revolving",
  "installment",
  "mortgage",
  "collection",
  "other",
  "unknown",
];

/**
 * Structured-output JSON (string or parsed) → CreditFile. Throws on
 * non-JSON so the job can be marked failed instead of saving an empty file.
 */

/** Claude account items (read or "find missing accounts" pass) → CreditAccount[]. */
export function parseAccountItems(raw: unknown, merged: boolean): CreditAccount[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((a: any) => a && str(a.creditor))
    .map((a: any) => {
      const bureaus: Partial<Record<Bureau, BureauTradeline>> = {};
      // Current shape: tradelines[] tagged by bureau. Legacy: transunion /
      // experian / equifax objects on the account.
      if (Array.isArray(a.tradelines)) {
        for (const t of a.tradelines) {
          const b = (Object.keys(BUREAU_KEYS) as Bureau[]).find((k) => BUREAU_KEYS[k] === t?.bureau);
          const tl = b ? toTradeline(t) : null;
          if (b && tl && !bureaus[b]) bureaus[b] = tl;
        }
      }
      for (const b of BUREAUS) {
        if (bureaus[b]) continue;
        const tl = toTradeline(a[BUREAU_KEYS[b]]);
        if (tl) bureaus[b] = tl;
      }
      const section = SECTIONS.includes(a.section) ? a.section : "unknown";
      
      // Merged rows: bureaus come ONLY from the Repository column.
      let bureausNotItemized = false;
      if (merged) {
        const repo = repositoryBureaus(a.repository);
        const one = BUREAUS.map((b) => bureaus[b]).find(Boolean) ?? null;
        for (const b of BUREAUS) delete bureaus[b];
        if (one) {
          if (repo.length) for (const b of repo) bureaus[b] = { ...one };
          else {
            bureaus.TU = one;
            bureausNotItemized = true;
          }
        }
      }
      const mask = str(a.account_mask);
      return {
        creditor: str(a.creditor)!,
        mask: mask ? mask.replace(/[^0-9A-Za-z]/g, "").slice(-4) || null : null,
        section,
        headerStatus: str(a.original_creditor)
          ? `Original creditor: ${str(a.original_creditor)}`
          : null,
        bureaus,
        confident: Object.keys(bureaus).length > 0,
        ...(merged ? { merged: true } : {}),
        ...(bureausNotItemized ? { bureausNotItemized: true } : {}),
        ...(/^b-?2\b|joint/i.test(String(a.ecoa || "")) ? { joint: true } : {}),
        ...(str(a.ecoa) ? { ecoa: str(a.ecoa) } : {}),
        ...(num(a.high_credit) !== null ? { highCredit: num(a.high_credit) } : {}),
        ...(num(a.monthly_payment) !== null ? { monthlyPayment: num(a.monthly_payment) } : {}),
      } satisfies CreditAccount;
    });
}

/**
 * Per-bureau reports sometimes print ONE account in two places (MyFreeScoreNow
 * puts Experian's copy of a collection in a different section; a collection can
 * show the original creditor on one bureau and the collector on another; one
 * bureau prints no account number so its copy lands in its own row).
 * Rule A: same last 4 + same balance + no shared bureau = one account.
 * Rule B: same creditor + no shared bureau + compatible account numbers (equal,
 * or missing on one side) + same open month + at least one amount equal and
 * none contradicting (limit, high credit, balance) = one account.
 */
const isCollectionTl = (t: BureauTradeline) => /collection/i.test(`${t.accountStatus ?? ""} ${t.paymentStatus ?? ""} ${t.accountType ?? ""}`);
const creditorKey = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]+/g, "");
const monthKey = (raw: string | null | undefined): string | null => {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const d = new Date(t.replace(/^(\d{1,2})\/(\d{4})$/, "$1/01/$2"));
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth() + 1}`;
};

/** Rule B fingerprint check: the two rows describe the same tradeline. */
function sameTradeline(o: CreditAccount, a: CreditAccount, last4: (x: CreditAccount) => string | null): boolean {
  if (creditorKey(o.creditor) !== creditorKey(a.creditor)) return false;
  if (BUREAUS.some((x) => o.bureaus[x] && a.bureaus[x])) return false;
  const ko = last4(o);
  const ka = last4(a);
  if (ko && ka && !ko.endsWith(ka) && !ka.endsWith(ko)) return false;
  const tls = (x: CreditAccount) => BUREAUS.map((b) => x.bureaus[b]).filter((t): t is BureauTradeline => !!t);
  const opened = (x: CreditAccount) => tls(x).map((t) => monthKey(t.dateOpened)).find(Boolean) ?? null;
  const oo = opened(o);
  if (!oo || oo !== opened(a)) return false;
  const first = (x: CreditAccount, f: (t: BureauTradeline) => number | null | undefined) =>
    tls(x).map(f).find((v) => v !== null && v !== undefined && v > 0) ?? null;
  const amounts: Array<[number | null, number | null]> = [
    [first(o, (t) => t.creditLimit), first(a, (t) => t.creditLimit)],
    [o.highCredit ?? first(o, (t) => t.highBalance), a.highCredit ?? first(a, (t) => t.highBalance)],
    [first(o, (t) => t.balance), first(a, (t) => t.balance)],
  ];
  const both = amounts.filter(([x, y]) => x !== null && y !== null);
  return both.length > 0 && both.every(([x, y]) => x === y);
}

/**
 * Rule C (Nov 3, 2026): the same account read twice on the same bureau(s) — same creditor, same
 * bureaus, and every core field identical on each bureau, with a real balance. A balance of $0
 * never matches: lenders report several paid / transferred loans with the same name and open
 * date, and those are separate accounts.
 */
function sameRowReadTwice(o: CreditAccount, a: CreditAccount): boolean {
  if (creditorKey(o.creditor) !== creditorKey(a.creditor)) return false;
  const on = BUREAUS.filter((x) => o.bureaus[x]);
  if (!on.length || on.length !== BUREAUS.filter((x) => a.bureaus[x]).length) return false;
  const digits = (x: CreditAccount) => String(x.mask ?? "").replace(/[^0-9]/g, "");
  if (digits(o) !== digits(a)) return false;
  return on.every((x) => {
    const p = o.bureaus[x];
    const q = a.bureaus[x];
    if (!p || !q || !(Number(p.balance) > 0)) return false;
    return (["dateOpened", "balance", "creditLimit", "highBalance", "accountStatus", "paymentStatus", "pastDue", "late30", "late60", "late90"] as const).every(
      (f) => (p[f] ?? null) === (q[f] ?? null),
    );
  });
}

export function consolidateSplitAccounts(
  accounts: CreditAccount[],
  opts: { keepSameBureauTwins?: boolean } = {},
): CreditAccount[] {
  const out: CreditAccount[] = [];
  const bal = (a: CreditAccount) => BUREAUS.map((b) => a.bureaus[b]?.balance).find((v) => v !== null && v !== undefined) ?? null;
  const last4 = (a: CreditAccount) => {
    const m = String(a.mask ?? "").replace(/[^0-9]/g, "");
    return m.length >= 2 ? m.slice(-4) : null;
  };
  for (const a of accounts) {
    const k = last4(a);
    const b = bal(a);
    const twin =
      (k && b !== null && b > 0
        ? out.find((o) => {
            if (last4(o) !== k || bal(o) !== b) return false;
            const shared = BUREAUS.filter((x) => o.bureaus[x] && a.bureaus[x]);
            if (!shared.length) return true;
            if (opts.keepSameBureauTwins) return false;
            // Same bureau twice (MyFreeScoreNow, a client Oct 26): one collection listed under the collector's
            // name and again under its client's name — same last 4, same balance, collection on both.
            return shared.every(
              (x) => isCollectionTl(o.bureaus[x]!) && isCollectionTl(a.bureaus[x]!) && o.bureaus[x]!.balance === a.bureaus[x]!.balance,
            );
          })
        : undefined) ?? out.find((o) => sameTradeline(o, a, last4) || (!opts.keepSameBureauTwins && sameRowReadTwice(o, a)));
    if (!twin) {
      out.push(a);
      continue;
    }
    for (const x of BUREAUS) if (a.bureaus[x] && !twin.bureaus[x]) twin.bureaus[x] = a.bureaus[x];
    // The row that has the account number keeps it.
    if (!last4(twin) && k) twin.mask = a.mask;
    // Keep the collector's name and the collection section; remember the other name.
    const aIsColl = a.section === "collection" || /collection/i.test(BUREAUS.map((x) => a.bureaus[x]?.accountStatus ?? "").join(" "));
    if (aIsColl && twin.section !== "collection") twin.section = a.section === "collection" ? "collection" : twin.section;
    if (twin.creditor.toLowerCase() !== a.creditor.toLowerCase() && !twin.headerStatus) {
      twin.headerStatus = `Original creditor: ${a.creditor}`;
    }
  }
  return out;
}

/**
 * Stored reads get today's account merge rules too (reads saved before a rule existed keep
 * duplicates otherwise). Per-bureau layouts only; tri-merge rows are never merged.
 */
export function normalizeStoredRead<F extends CreditFile>(
  file: F,
  summary?: PrintedBureauTotals | null,
  skeleton?: Pick<CreditFile, "accounts"> | null,
  exclusions?: ReadExclusion[] | null,
): F {
  if (!file?.accounts || file.reportFormat === "merged") return file;
  const base = exclusions?.length ? applyReadExclusions(file.accounts, exclusions) : file.accounts;
  const copy = () => base.map((a) => ({ ...a, bureaus: { ...a.bureaus } }));
  let accounts = consolidateSplitAccounts(copy());
  if (summary) accounts = summaryAwareAccounts(accounts, () => consolidateSplitAccounts(copy(), { keepSameBureauTwins: true }), summary);
  if (summary && skeleton?.accounts?.length) accounts = trimExtraReads(accounts, skeleton.accounts, summary).accounts;
  return { ...file, accounts };
}

/** A row staff marked "not a real account" on one bureau of one pull. */
export interface ReadExclusion {
  bureau: Bureau;
  creditor: string;
  mask: string | null;
  balance: number | null;
  dateOpened: string | null;
}

const sameAmount = (x: number | null | undefined, y: number | null | undefined) =>
  (x ?? null) === null || (y ?? null) === null ? (x ?? null) === (y ?? null) : Math.abs(Number(x) - Number(y)) < 0.005;

/**
 * Removes each excluded row from its bureau — one row per exclusion, matched on creditor, number,
 * balance and open date, so a twin that is a real account stays. An account left with no bureau
 * is dropped. Rows that no longer match (a later re-read) are simply not found.
 */
const exclusionFits = (a: CreditAccount, x: ReadExclusion) =>
  !!a.bureaus[x.bureau] &&
  a.creditor === x.creditor &&
  // The merge step may give a row its twin's number: fragments that agree count ("1" / "1234").
  masksAgreeLoose(a.mask, x.mask) &&
  sameAmount(a.bureaus[x.bureau]!.balance, x.balance) &&
  (a.bureaus[x.bureau]!.dateOpened ?? null) === (x.dateOpened ?? null);

function masksAgreeLoose(p: string | null | undefined, q: string | null | undefined): boolean {
  const a = String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = String(q ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return a === b || (!!a && !!b && (a.endsWith(b) || b.endsWith(a)));
}

/** How many stored rows one exclusion can match (the cap on how many times it may be saved). */
export function readExclusionMatches(accounts: CreditAccount[], x: ReadExclusion): number {
  return accounts.filter((a) => exclusionFits(a, x)).length;
}

export function applyReadExclusions(accounts: CreditAccount[], exclusions: ReadExclusion[]): CreditAccount[] {
  let out = accounts.map((a) => ({ ...a, bureaus: { ...a.bureaus } }));
  for (const x of exclusions) {
    // Exact number first, then an agreeing fragment.
    const hit = out.find((a) => exclusionFits(a, x) && (a.mask ?? null) === (x.mask ?? null)) ?? out.find((a) => exclusionFits(a, x));
    if (hit) delete hit.bureaus[x.bureau];
  }
  out = out.filter((a) => BUREAUS.some((b) => a.bureaus[b]));
  return out;
}

/** One account row on one bureau that the AI read but the text reader did not find. */
export interface SuspectedExtraRead {
  bureau: Bureau;
  creditor: string;
  mask: string | null;
  balance: number | null;
  dateOpened: string | null;
  /** Fragment = the row has no account or payment status (a piece of a page-broken block). */
  fragment: boolean;
}

const creditorKey8 = (creditor: string) => String(creditor || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
/** Visible account-number characters (the text reader prints leading digits, the AI the last ones). */
const maskChars = (m: string | null | undefined) => String(m ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const unreadableHeader = (a: CreditAccount) => /^\(unreadable/i.test(String(a.creditor || "").trim());
/** The text reader sometimes folds the number into the creditor name ("AFFIRM INC C0YEQM*"). */
const skeletonMask = (a: CreditAccount) => {
  const m = maskChars(a.mask);
  if (m) return m;
  const tail = String(a.creditor || "").trim().split(/\s+/).pop() ?? "";
  return /[0-9]/.test(tail) && /\*$/.test(tail) ? maskChars(tail) : "";
};
const masksAgree = (ai: string, sk: string) => !ai || !sk || sk.endsWith(ai) || ai.endsWith(sk) || sk.includes(ai);

/**
 * Nov 12, 2026 audit (109 held progress reports): on 176 of 182 bureau totals that missed the
 * report's own summary, the AI read MORE accounts than the report lists — a loan read twice at a
 * page break, a partial row with no status. The text reader, run on the same PDF, matched the
 * summary on 120 of them. Existing merge rules can't catch these ($0 rows never merge, on purpose).
 *
 * Per bureau, only when the text reader's count equals the printed total and the AI's is higher:
 * every text-reader row is paired with one AI row (same creditor, account numbers that agree; the
 * best-read AI row first), and rows whose header the text reader could not read pair with any AI
 * row left. AI rows still unpaired are the extras. They are removed only if that lands exactly on
 * the printed total, no text-reader row went unpaired, and — when the report prints a balance
 * total for that bureau — the balance gets no further from it. Otherwise nothing is removed and the
 * rows come back as suspects for staff.
 */
export function trimExtraReads(
  accounts: CreditAccount[],
  skeletonAccounts: CreditAccount[],
  summary: PrintedBureauTotals & { perBureau?: Partial<Record<Bureau, { totalAccounts?: number | null; balances?: number | null } | null>> | null },
): { accounts: CreditAccount[]; trimmed: SuspectedExtraRead[]; suspects: SuspectedExtraRead[] } {
  let out = accounts;
  const trimmed: SuspectedExtraRead[] = [];
  const suspects: SuspectedExtraRead[] = [];
  for (const b of BUREAUS) {
    const want = summary.perBureau?.[b]?.totalAccounts;
    if (typeof want !== "number") continue;
    const onAi = out.filter((a) => a.bureaus[b]);
    const onSk = skeletonAccounts.filter((a) => a.bureaus?.[b]);
    if (onSk.length !== want || onAi.length <= want) continue;
    const tl = (r: CreditAccount) => r.bureaus[b]!;
    const isFragment = (r: CreditAccount) => !tl(r).accountStatus && !tl(r).paymentStatus;
    // Best-read rows pair first, so the leftovers are the fragments / copies.
    const ranked = [...onAi].sort((x, y) => Number(isFragment(x)) - Number(isFragment(y)) || maskChars(y.mask).length - maskChars(x.mask).length);
    const free = new Set(ranked);
    let skeletonUnpaired = 0;
    const wildcards = onSk.filter(unreadableHeader).length;
    // Pass 1: same creditor and agreeing account numbers. Pass 2: same creditor only, for the rows
    // left on both sides (the AI misreads a digit: "5805" for "7805").
    const namedSk = onSk.filter((x) => !unreadableHeader(x));
    const skLeft = namedSk.filter((sk) => {
      const g = creditorKey8(sk.creditor);
      const m = skeletonMask(sk);
      const hit = ranked.find((r) => free.has(r) && creditorKey8(r.creditor) === g && masksAgree(maskChars(r.mask), m));
      if (hit) free.delete(hit);
      return !hit;
    });
    for (const sk of skLeft) {
      const hit = ranked.find((r) => free.has(r) && creditorKey8(r.creditor) === creditorKey8(sk.creditor));
      if (hit) free.delete(hit);
      else skeletonUnpaired++;
    }
    // Unreadable headers stand for creditors the text reader never named; those AI rows go first.
    const named = new Set(namedSk.map((x) => creditorKey8(x.creditor)));
    for (let n = 0; n < wildcards; n++) {
      const hit = ranked.find((r) => free.has(r) && !named.has(creditorKey8(r.creditor))) ?? ranked.find((r) => free.has(r));
      if (hit) free.delete(hit);
    }
    const extras = ranked.filter((r) => free.has(r));
    const describe = (r: CreditAccount): SuspectedExtraRead => ({
      bureau: b,
      creditor: r.creditor,
      mask: r.mask ?? null,
      balance: r.bureaus[b]?.balance ?? null,
      dateOpened: r.bureaus[b]?.dateOpened ?? null,
      fragment: isFragment(r),
    });
    if (!extras.length) continue;
    const printedBalance = summary.perBureau?.[b]?.balances;
    const sum = (list: CreditAccount[]) => list.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
    const kept = onAi.filter((r) => !free.has(r));
    const balanceOk =
      typeof printedBalance !== "number" || Math.abs(sum(kept) - printedBalance) <= Math.abs(sum(onAi) - printedBalance);
    if (skeletonUnpaired === 0 && onAi.length - extras.length === want && balanceOk) {
      trimmed.push(...extras.map(describe));
      const drop = new Set(extras);
      out = out
        .map((a) => {
          if (!drop.has(a)) return a;
          const bureaus = { ...a.bureaus };
          delete bureaus[b];
          return { ...a, bureaus };
        })
        .filter((a) => BUREAUS.some((x) => a.bureaus[x]));
    } else {
      suspects.push(...extras.map(describe));
    }
  }
  return { accounts: out, trimmed, suspects };
}

/** The per-bureau account totals a pull prints about itself (the progress-report pull summary). */
export interface PrintedBureauTotals {
  perBureau?: Partial<Record<Bureau, { totalAccounts?: number | null } | null>> | null;
}

/**
 * Nov 12, 2026 (a client failed the self-check on six rounds in a row): a bureau can really list one
 * account twice — Equifax printed an Ally card twice (same last 4, same $2,367) and counted both in
 * its own summary (34 accounts, $34,939). The same-bureau merge rules (written for MyFreeScoreNow
 * listing one collection under two names) folded them into one, so the read showed 33 and $32,572.
 * The pull's own per-bureau totals decide: when merging leaves a bureau short of what the report
 * prints, keep same-bureau twins — only if that is at least as close on every bureau and closer on
 * a short one. Without a printed total nothing changes.
 */
export function summaryAwareAccounts(
  merged: CreditAccount[],
  keepTwins: () => CreditAccount[],
  summary: PrintedBureauTotals,
): CreditAccount[] {
  const targets: Array<[Bureau, number]> = [];
  for (const b of BUREAUS) {
    const want = summary.perBureau?.[b]?.totalAccounts;
    if (typeof want === "number") targets.push([b, want]);
  }
  if (!targets.length) return merged;
  const count = (list: CreditAccount[], b: Bureau) => list.filter((a) => a.bureaus[b]).length;
  if (!targets.some(([b, want]) => count(merged, b) < want)) return merged;
  const kept = keepTwins();
  const gap = (list: CreditAccount[], b: Bureau, want: number) => Math.abs(count(list, b) - want);
  const neverWorse = targets.every(([b, want]) => gap(kept, b, want) <= gap(merged, b, want));
  const closer = targets.some(([b, want]) => count(merged, b) < want && gap(kept, b, want) < gap(merged, b, want));
  return neverWorse && closer ? kept : merged;
}

export function parseCreditFileExtraction(
  raw: string | Record<string, unknown>,
  provider: CreditFileProvider,
): CreditFile & { scoreModel: string | null; unreadablePages: number[] } {
  const data: any = typeof raw === "string" ? JSON.parse(raw) : raw;
  const merged = data?.report_format === "merged";
  const items = parseAccountItems(data?.accounts, merged);
  const accounts: CreditAccount[] = merged ? items : consolidateSplitAccounts(items);
  const inquiries: CreditInquiry[] = (Array.isArray(data?.inquiries) ? data.inquiries : [])
    .filter((q: any) => q && str(q.date) && str(q.creditor))
    .map((q: any) => ({
      date: str(q.date)!,
      creditor: str(q.creditor)!,
      bureau: bureauOrNull(q.bureau),
      matchedAccount: null,
    }));
  const scoreOf = (v: unknown) => {
    const n = num(v);
    return n !== null && n >= 300 && n <= 850 ? n : null;
  };
  const unreadablePages: number[] = Array.isArray(data?.unreadable_pages)
    ? data.unreadable_pages.filter((n: unknown) => Number.isInteger(n))
    : [];
  const pr = num(data?.public_records_count);
  return {
    provider,
    reportDate: str(data?.report_date),
    scores: {
      TU: scoreOf(data?.scores?.transunion),
      EX: scoreOf(data?.scores?.experian),
      EQ: scoreOf(data?.scores?.equifax),
    },
    accounts,
    inquiries,
    publicRecordsReported: pr === null ? null : pr > 0,
    imagePages: 0,
    totalPages: 0,
    confidence: 1,
    warnings: unreadablePages.length
      ? [`Claude could not read page(s): ${unreadablePages.join(", ")}`]
      : [],
    scoreModel: str(data?.score_model),
    scoreRatings: {
      TU: str(data?.score_ratings?.transunion),
      EX: str(data?.score_ratings?.experian),
      EQ: str(data?.score_ratings?.equifax),
    },
    identityFlags: (Array.isArray(data?.identity_variations) ? data.identity_variations : [])
      .filter((v: any) => v && ["name", "ssn", "dob", "address"].includes(v.field))
      .map((v: any) => ({
        bureau: bureauOrNull(v.bureau),
        field: v.field,
        // Defense in depth: strip SSN-shaped values only (years, ZIPs and house numbers stay whole).
        detail: maskSsnLike(String(v.detail || "")).slice(0, 600),
      })),
    unreadablePages,
    reportFormat: data?.report_format === "merged" ? "merged" : "per_bureau",
    borrowerName: str(data?.borrower_name),
    borrowerAddress: str(data?.borrower_address),
    lender:
      str(data?.lender_name) || str(data?.requested_date)
        ? {
            name: str(data?.lender_name),
            requestedDate: str(data?.requested_date),
            requestedBy: str(data?.requested_by),
            vendor: str(data?.credit_vendor),
            reportId: str(data?.report_id),
          }
        : null,
    vantageScores: {
      TU: scoreOf(data?.vantage_scores?.transunion),
      EX: scoreOf(data?.vantage_scores?.experian),
      EQ: scoreOf(data?.vantage_scores?.equifax),
    },
    scoreReasonCodes: (Array.isArray(data?.score_reason_codes) ? data.score_reason_codes : [])
      .map((x: unknown) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 40),
    summary: parseSummaryText(data?.summary),
    readEntries: items.length,
    lenderSimulation: str(data?.lender_simulation),
  };
}

/** "total_accounts=29; total_balance=105605; …" (or a legacy object) → summary; null when empty. */
export function parseSummaryText(raw: unknown): CreditReportSummary | null {
  const kv: Record<string, unknown> = {};
  if (raw && typeof raw === "object") Object.assign(kv, raw);
  else
    for (const part of String(raw ?? "").split(/[;\n]/)) {
      const m = part.match(/^\s*([a-z_0-9]+)\s*[=:]\s*(.+?)\s*$/i);
      if (m) kv[m[1].toLowerCase()] = m[2];
    }
  const out: CreditReportSummary = {
    totalAccounts: num(kv.total_accounts),
    revolvingAccounts: num(kv.revolving_accounts),
    installmentAccounts: num(kv.installment_accounts),
    otherAccounts: num(kv.other_accounts),
    totalBalance: num(kv.total_balance),
    revolvingBalance: num(kv.revolving_balance),
    pastDue: num(kv.past_due),
    late30: num(kv.late_30),
    late60: num(kv.late_60),
    late90: num(kv.late_90),
    revolvingUtilizationPct: num(String(kv.revolving_utilization_pct ?? "").replace("%", "")),
    revolvingUsedPct: num(String(kv.revolving_used_pct ?? "").replace("%", "")),
    collectionsChargeOffs: num(kv.collections_chargeoffs),
    inquiries: num(kv.inquiries),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** "transunion" / "experian" / "equifax" → bureau; anything else (incl. not_itemized) → null. */
function bureauOrNull(v: unknown): Bureau | null {
  return v === "transunion" ? "TU" : v === "experian" ? "EX" : v === "equifax" ? "EQ" : null;
}

/**
 * Repository code → bureaus. Xactus prints EXP / TUC / EQX ("EXP/TUC/EQX",
 * "EQX/TUC", "EQX"); others TU / EQ / XP or the bureau names. EQX was missed
 * before (Laila, Oct 26: Equifax read as 0 accounts).
 */
export function repositoryBureaus(raw: unknown): Bureau[] {
  const t = String(raw ?? "").toUpperCase().replace(/[-_]B\d\b/g, "");
  const out: Bureau[] = [];
  if (/\bTU\b|TRANS\s*UNION|\bTUC\b|\bTRU\b/.test(t)) out.push("TU");
  if (/\bXP\b|\bEX\b|\bEXP\b|\bXPN\b|EXPERIAN/.test(t)) out.push("EX");
  if (/\bEQ\b|\bEQX\b|\bEFX\b|EQUIFAX/.test(t)) out.push("EQ");
  return out;
}

/** SSN-shaped values only (123-45-6789 / 123456789); dates, ZIPs and house numbers are kept. */
export function maskSsnLike(text: string): string {
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g, "•••");
}

export interface CrossCheckIssue {
  severity: "error" | "warning";
  code:
    | "score_mismatch"
    | "account_count_mismatch"
    | "missing_account"
    | "inquiry_count_mismatch"
    | "unreadable_pages";
  message: string;
}

function normCreditor(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * SmartCredit "Print" saved before the account sections finished loading: the
 * account pages hold only loading spinners + the browser header/footer, so the
 * file has (almost) no accounts. Reading it as "ready" turned every missing
 * account into a "removal". Returns why, or null when the pull looks complete.
 */
export function incompleteSmartCreditPrint(
  extracted: { accounts: unknown[] },
  skeleton: Pick<CreditFile, "provider" | "imagePages" | "totalPages"> | null,
): string | null {
  if (!skeleton || skeleton.provider !== "smartcredit" || !skeleton.totalPages) return null;
  if (extracted.accounts.length > 3) return null;
  if (skeleton.imagePages < 3 || skeleton.imagePages < skeleton.totalPages * 0.4) return null;
  return `This PDF was saved before SmartCredit finished loading the accounts (${skeleton.imagePages} of ${skeleton.totalPages} pages are empty). Reopen the report in SmartCredit, wait until every account is visible, then Print → Save as PDF and upload it again.`;
}

/**
 * The text parser reads the report body's "Credit Report Date" row exactly;
 * Claude sometimes returns the browser print header/footer date (the day the
 * PDF was saved), which made every pull look like today's. Recognized
 * formats: the parsed date wins.
 */
export function preferSkeletonReportDate<T extends { reportDate: string | null }>(extracted: T, skeleton: CreditFile | null): T {
  // Any supported layout: the date its own summary prints (MyFreeScoreNow "Report Date", myFICO "AS OF", tri-merge "Ordered").
  const printed = (skeleton as (CreditFile & { pullSummary2?: { reportDate?: string | null } | null }) | null)?.pullSummary2?.reportDate;
  if (printed && /^\d{2}\/\d{2}\/\d{4}$/.test(printed)) return extracted.reportDate === printed ? extracted : { ...extracted, reportDate: printed };
  if (!skeleton || skeleton.provider === "unknown" || !/^\d{2}\/\d{2}\/\d{4}$/.test(String(skeleton.reportDate ?? ""))) return extracted;
  return extracted.reportDate === skeleton.reportDate ? extracted : { ...extracted, reportDate: skeleton.reportDate };
}

/**
 * Compare Claude's extraction with the text-parser skeleton (scores, account
 * headers, inquiries — which are reliable where the PDF has text). Issues are
 * shown to staff on the review screen; errors lower confidence.
 */
export function crossCheckCreditFile(
  extracted: CreditFile & { unreadablePages?: number[] },
  skeleton: CreditFile,
): { issues: CrossCheckIssue[]; confidence: number } {
  const issues: CrossCheckIssue[] = [];
  for (const b of BUREAUS) {
    const a = extracted.scores[b];
    const s = skeleton.scores[b];
    if (a !== null && s !== null && a !== s) {
      issues.push({
        severity: "error",
        code: "score_mismatch",
        message: `${b} score: extracted ${a}, report text says ${s}`,
      });
    }
  }
  // Text skeleton sees every account when no account pages are images.
  const textSeesAll = skeleton.imagePages === 0 && skeleton.accounts.length > 0;
  if (textSeesAll && extracted.accounts.length !== skeleton.accounts.length) {
    issues.push({
      severity: "error",
      code: "account_count_mismatch",
      message: `Extracted ${extracted.accounts.length} accounts; report lists ${skeleton.accounts.length}`,
    });
  } else if (extracted.accounts.length < skeleton.accounts.length) {
    issues.push({
      severity: "error",
      code: "account_count_mismatch",
      message: `Extracted ${extracted.accounts.length} accounts but the readable text alone shows ${skeleton.accounts.length}`,
    });
  }
  const extractedNames = extracted.accounts.map((a) => normCreditor(a.creditor));
  for (const acct of skeleton.accounts) {
    if (!acct.confident) continue; // header was on an image page
    const key = normCreditor(acct.creditor);
    if (key && !extractedNames.some((n) => n === key || n.includes(key) || key.includes(n))) {
      issues.push({
        severity: "warning",
        code: "missing_account",
        message: `"${acct.creditor}" appears in the report text but was not extracted`,
      });
    }
  }
  if (
    skeleton.inquiries.length > 0 &&
    extracted.inquiries.length !== skeleton.inquiries.length
  ) {
    issues.push({
      severity: "warning",
      code: "inquiry_count_mismatch",
      message: `Extracted ${extracted.inquiries.length} inquiries; report lists ${skeleton.inquiries.length}`,
    });
  }
  if (extracted.unreadablePages?.length) {
    issues.push({
      severity: "warning",
      code: "unreadable_pages",
      message: `Unreadable page(s): ${extracted.unreadablePages.join(", ")}`,
    });
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const confidence = Math.max(0, 1 - errors * 0.3 - warnings * 0.05);
  return { issues, confidence: Math.round(confidence * 100) / 100 };
}

// ── Review passes (Spec §11 + Claude auditor) ───────────────────────────────

function fileBlockFor(data: string, mediaType: CreditFileMediaType) {
  return mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/**
 * "Find the missing accounts": the report's own summary has more accounts than
 * the read. Returns ONLY accounts not in `have`, in the same shape as the read.
 */
export function buildCreditFileReconcileParams(opts: {
  fileBase64: string;
  mediaType: CreditFileMediaType;
  model: string;
  reportFormat: "per_bureau" | "merged";
  expected: string;
  have: Array<{ creditor: string; mask: string | null; section: string }>;
}): Record<string, unknown> {
  const list = opts.have.map((a) => `- ${a.creditor}${a.mask ? ` ...${a.mask}` : ""} (${a.section})`).join("\n");
  const text = `This credit report's own Account Summary says: ${opts.expected}.
A first read found only these ${opts.have.length} accounts:
${list}
Find EVERY tradeline account on the report that is NOT in that list (check every page and section, including closed, paid, collection and "other" accounts). Return only the missing accounts, with the same rules as a normal read: values verbatim, "" for blanks, report_format is ${opts.reportFormat}${opts.reportFormat === "merged" ? " (bureaus only from the Repository column)" : ""}. Return an empty list if none are missing — never repeat a listed account and never invent one.`;
  return {
    model: opts.model,
    max_tokens: 8000,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { accounts: { type: "array", items: ACCOUNT_ITEM_SCHEMA } },
          required: ["accounts"],
        },
      },
    },
    messages: [{ role: "user", content: [fileBlockFor(opts.fileBase64, opts.mediaType), { type: "text", text }] }],
  };
}

export interface CreditAuditFinding {
  check: string;
  severity: "blocking" | "note";
  detail: string;
  /** What the analysis states vs what the report prints (a finding must show a real difference). */
  analysisSays?: string;
  reportShows?: string;
}

/** Spec v2.1 checks the auditor verifies against the source report. */
export const CREDIT_AUDIT_CHECKLIST = [
  "Client name matches the Borrower / consumer block (never a placeholder).",
  "Each bureau's score matches the report; the middle score is the middle of the three.",
  "Active transaction: if a lender pulled this report (tri-merge Lender / Requested by) or a mortgage/auto inquiry is within 30 days, it is flagged and that lender's inquiry is EXCLUDED, not a dispute target.",
  "Every bureau tag in the analysis is printed on the report; anything unlabeled is 'Not itemized' (never guessed).",
  "No positive account (no lates, no derogatory status, no collection) appears in any dispute round.",
  "Every account with late counts > 0, a charge-off, collection, repossession or derogatory remark is in the negatives (current 'As Agreed' status does not make it positive).",
  "Round 2 = third-party collections; Round 3 = late-payment-only accounts and duplicates; Round 4 = charge-offs / repossessions / original-creditor derogatory.",
  "Late counts, balances and past-due amounts in the analysis match the report.",
  "No account on the report is missing from the analysis, and no account in the analysis is absent from the report.",
  "Dispute remarks (active or resolved) are informational, not new targets.",
  "Each negative account shows ONE derogatory date (its first late on the payment grid) everywhere it appears.",
];

/** Spec v2.1 policies the auditor must not second-guess (they look odd but are intended). */
export const CREDIT_AUDIT_POLICIES = [
  "Round rules are by item type: a late-payment-only account is Round 3 even with 90-day lates; charge-offs are Round 4.",
  "An inquiry tied to an account opened within ~90 days (including lender/dealer pairs such as Carvana -> Bridgecrest) is EXCLUDED as permissible purpose.",
  "The active lender's own pull is excluded as permissible purpose (active transaction).",
  "Account numbers are shown as the last 4 digits only; accounts that share a last 4 are told apart by open date.",
  "Accounts with late counts are negative even when the report's Adverse / derogatory summary does not list them, and the same card under two furnisher names counts as two negative tradelines (one unique account).",
  "Personal-information variances are Round 1; bureaus the report does not label are 'Not itemized'.",
];

export function buildCreditFileAuditParams(opts: {
  fileBase64: string;
  mediaType: CreditFileMediaType;
  model: string;
  analysisSummary: string;
}): Record<string, unknown> {
  const text = `You are auditing an automated credit analysis against the ORIGINAL credit report attached. Do not redo the analysis; find FACTUAL errors in it.
Checklist:
${CREDIT_AUDIT_CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join("\n")}

FIXED company policies — following them is NEVER an error, do not report them:
${CREDIT_AUDIT_POLICIES.map((c) => `- ${c}`).join("\n")}

Analysis to verify:
${opts.analysisSummary}

Rules for findings:
- Several accounts can share a creditor name and last 4 digits (refinances, duplicates under two furnisher names): tell them apart by the open date shown — that is not an error.
- Report ONLY real errors: a value, account, bureau, round or name in the analysis that DIFFERS from what the report prints, or something on the report the analysis is missing.
- NEVER include checks that passed, confirmations, or "for completeness" items. If everything checks out, return an empty list.
- Each finding: analysis_says = the analysis's exact value; report_shows = what the report prints (quote it); detail = one sentence.
- severity "blocking" = wrong data a client would receive (wrong name, score, round, bureau, missing or invented account, positive in a round, lender inquiry disputed). "note" = a real but minor discrepancy.`;
  return {
    model: opts.model,
    max_tokens: 4000,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  check: STR,
                  severity: { type: "string", description: "blocking | note" },
                  analysis_says: STR,
                  report_shows: STR,
                  detail: STR,
                },
                required: ["check", "severity", "analysis_says", "report_shows", "detail"],
              },
            },
          },
          required: ["findings"],
        },
      },
    },
    messages: [{ role: "user", content: [fileBlockFor(opts.fileBase64, opts.mediaType), { type: "text", text }] }],
  };
}

/** Confirmations the model sometimes returns as "findings" — never a problem. */
const AUDIT_NON_FINDING =
  /\b(no error|not an error|no issue|no problem|confirmed correct|is correct|are correct|handles this correctly|correctly (placed|excluded|identified|labeled|labelled)|matches the report|count matches|for completeness|acceptable|this passes|disregard|removing this finding|no (count |numeric )?errors? (detected|found))\b/i;

function auditNorm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function parseAuditFindings(raw: string | Record<string, unknown>): CreditAuditFinding[] {
  const data: any = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (Array.isArray(data?.findings) ? data.findings : [])
    .filter((f: any) => f && str(f.detail))
    // A finding must show a real difference between the analysis and the report.
    .filter((f: any) => {
      const says = auditNorm(f.analysis_says);
      const shows = auditNorm(f.report_shows);
      if (says && shows && says === shows) return false;
      return !AUDIT_NON_FINDING.test(String(f.detail));
    })
    .map((f: any) => ({
      check: String(f.check ?? "").slice(0, 200),
      severity: f.severity === "blocking" ? ("blocking" as const) : ("note" as const),
      detail: String(f.detail).replace(/\d{3}-?\d{2}-?\d{4}/g, "•••").slice(0, 600),
      ...(str(f.analysis_says) ? { analysisSays: String(f.analysis_says).slice(0, 200) } : {}),
      ...(str(f.report_shows) ? { reportShows: String(f.report_shows).slice(0, 200) } : {}),
    }))
    .slice(0, 30);
}

const AUDIT_KEY_STOPWORDS = new Set([
  "THE", "AND", "FOR", "NOT", "BUT", "ARE", "WAS", "HAS", "WITH", "FROM", "THIS", "THAT", "ROUND", "ACCOUNT", "ACCOUNTS",
  "ANALYSIS", "REPORT", "SHOWS", "LISTED", "LISTS", "POSITIVE", "NEGATIVE", "BUREAU", "BUREAUS", "INQUIRY", "INQUIRIES",
  "BLOCKING", "NOTE", "TARGET", "TARGETS", "DISPUTE", "LATE", "LATES", "CLOSED", "OPEN", "PAID", "BALANCE", "SCORE",
]);

/** Creditor names / numbers a finding is about (for matching two audit runs). */
export function auditFindingKeys(f: CreditAuditFinding): Set<string> {
  const text = `${f.check} ${f.detail} ${f.analysisSays ?? ""} ${f.reportShows ?? ""}`;
  const keys = new Set<string>();
  for (const m of text.match(/\b[A-Z][A-Z0-9&./']{2,}\b/g) ?? []) {
    const k = m.replace(/[^A-Z0-9]/g, "");
    if (k.length >= 3 && !AUDIT_KEY_STOPWORDS.has(k)) keys.add(k);
  }
  for (const m of text.match(/\b\d{3,4}\b/g) ?? []) keys.add(m);
  return keys;
}

/**
 * Self-consistency: two independent audit runs. A BLOCKING finding survives
 * only when the other run also flags a blocking problem about the same
 * creditor / account (one-off hallucinations drop out). Notes from run A are kept.
 */
export function consensusAuditFindings(a: CreditAuditFinding[], b: CreditAuditFinding[]): CreditAuditFinding[] {
  const bBlocking = b.filter((f) => f.severity === "blocking").map(auditFindingKeys);
  const out: CreditAuditFinding[] = [];
  for (const f of a) {
    if (f.severity !== "blocking") {
      out.push(f);
      continue;
    }
    const keys = auditFindingKeys(f);
    const confirmed = bBlocking.some((k) => [...keys].some((x) => k.has(x)));
    out.push(confirmed ? f : { ...f, severity: "note", detail: `(unconfirmed) ${f.detail}` });
  }
  return out;
}


// ── Read speed (Oct 27): reuse identical files, split large reports ─────────

/** Bump when the read output changes meaning without a prompt/schema change. */
const CREDIT_FILE_READER_REV = "r1";

/** FNV-1a (32-bit) — stable short fingerprint (no crypto import in the inlined engine). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Reader fingerprint: prompt + schema + revision + model. A stored read is reused for an
 * identical file only when this matches, so a reader change never serves an old read.
 */
export function creditFileExtractVersion(model: string): string {
  const fp = fnv1a(`${CREDIT_FILE_READER_REV}|${CREDIT_FILE_EXTRACTION_PROMPT}|${JSON.stringify(CREDIT_FILE_EXTRACTION_SCHEMA)}`);
  return `${fp}-${String(model).replace(/[^a-z0-9.]+/gi, "").slice(0, 15)}`;
}

/** Page ranges (0-based, inclusive) for one report; 1 range = read in one pass. */
export type CreditFilePart = { start: number; end: number };

/** Below this a single pass finishes well inside the time limit (≈30 accounts ≈ 2 min). */
const SPLIT_MIN_PAGES = 10;
const SPLIT_MIN_ACCOUNTS = 30;
const SPLIT_PAGES_PER_PART = 9;
const SPLIT_ACCOUNTS_PER_PART = 18;
const SPLIT_MAX_PARTS = 4;
const SPLIT_MIN_PAGES_PER_PART = 4;

/**
 * Splits a large per-bureau report into 2-4 page ranges read in parallel (output — not
 * input — sets the read time). Neighbouring ranges share one page so an account printed
 * across a page break is whole in at least one part; the merge drops the overlap copy.
 */
export function planCreditFileParts(opts: { pages: number; estAccounts?: number | null; forceSplit?: boolean }): CreditFilePart[] {
  const pages = Math.max(0, Math.floor(opts.pages || 0));
  const est = Math.max(0, Math.floor(opts.estAccounts ?? 0));
  const one = [{ start: 0, end: Math.max(0, pages - 1) }];
  if (pages < SPLIT_MIN_PAGES_PER_PART * 2) return one;
  if (!opts.forceSplit && pages < SPLIT_MIN_PAGES && est < SPLIT_MIN_ACCOUNTS) return one;
  const want = Math.max(2, Math.ceil(pages / SPLIT_PAGES_PER_PART), Math.ceil(est / SPLIT_ACCOUNTS_PER_PART));
  const parts = Math.min(SPLIT_MAX_PARTS, want, Math.floor(pages / SPLIT_MIN_PAGES_PER_PART));
  if (parts < 2) return one;
  const out: CreditFilePart[] = [];
  for (let i = 0; i < parts; i++) {
    const start = Math.floor((i * pages) / parts);
    const end = Math.min(pages - 1, Math.floor(((i + 1) * pages) / parts) - 1 + (i < parts - 1 ? 1 : 0));
    out.push({ start, end });
  }
  return out;
}

/** Instruction for one part of a split read. */
export function creditFilePartNote(part: CreditFilePart, index: number, total: number, pages: number): string {
  return (
    `This file is pages ${part.start + 1}-${part.end + 1} of a ${pages}-page report (part ${index + 1} of ${total}); ` +
    "the other pages are read separately. Extract everything printed on THESE pages only and never invent what is not shown. " +
    "An account may start on the previous part or continue into the next: return the part of it shown here (creditor, account number and every field you can see). " +
    "Leave scores, personal information, inquiries or summary empty when they are not on these pages."
  );
}

const tlFilled = (t: BureauTradeline | undefined) => (t ? Object.values(t).filter((v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)).length : 0);

/** Field-wise union of two reads of the same tradeline (the fuller copy wins each field). */
function mergeTradeline(a: BureauTradeline, b: BureauTradeline): BureauTradeline {
  const [main, other] = tlFilled(a) >= tlFilled(b) ? [a, b] : [b, a];
  const out = { ...main } as Record<string, unknown>;
  for (const [k, v] of Object.entries(other)) {
    const cur = out[k];
    if (cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && !cur.length)) out[k] = v;
  }
  return out as unknown as BureauTradeline;
}

/** Accounts that can sit on the one page two neighbouring parts share (a dense SmartCredit page holds ~3). */
const PART_OVERLAP_ACCOUNTS = 4;

/** The same account seen in two overlapping parts (same creditor, compatible number, no contradiction). */
function samePartAccount(x: CreditAccount, y: CreditAccount): boolean {
  if (creditorKey(x.creditor) !== creditorKey(y.creditor)) return false;
  // Account numbers as printed (letters count: BNPL loans print "ZQ", "A4"…); masking chars dropped.
  const tail = (a: CreditAccount) => {
    const d = String(a.mask ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^X+/, "");
    return d.length >= 2 ? d.slice(-4) : null;
  };
  const dx = tail(x);
  const dy = tail(y);
  if (dx && dy && !dx.endsWith(dy) && !dy.endsWith(dx)) return false;
  const shared = BUREAUS.filter((b) => x.bureaus[b] && y.bureaus[b]);
  if (!shared.length) return false;
  return shared.every((b) => {
    const p = x.bureaus[b]!;
    const q = y.bureaus[b]!;
    const mo = (t: BureauTradeline) => monthKey(t.dateOpened);
    if (mo(p) && mo(q) && mo(p) !== mo(q)) return false;
    if (p.balance != null && q.balance != null && p.balance !== q.balance) return false;
    if (p.creditLimit != null && q.creditLimit != null && p.creditLimit !== q.creditLimit) return false;
    return !!(mo(p) || mo(q) || p.balance != null || q.balance != null);
  });
}

/**
 * Combines the parts of a split read into one CreditFile (same shape as a single pass):
 * first value wins for report-level fields, overlap copies of an account are merged
 * field by field, then the split-account rules run; inquiries / personal info de-duplicated.
 */
export function mergeCreditFileParts<F extends CreditFile & { scoreModel?: string | null; unreadablePages?: number[] }>(
  parts: Array<{ file: F; firstPage: number }>,
): F {
  if (!parts.length) throw new Error("No parts to merge");
  const first = <T,>(pick: (f: F) => T | null | undefined): T | null => {
    for (const p of parts) {
      const v = pick(p.file);
      if (v !== null && v !== undefined && v !== "") return v as T;
    }
    return null;
  };
  const perBureau = <T,>(pick: (f: F) => Partial<Record<Bureau, T | null>> | undefined) =>
    Object.fromEntries(BUREAUS.map((b) => [b, first((f) => pick(f)?.[b] ?? null)])) as Record<Bureau, T | null>;
  const accounts: CreditAccount[] = [];
  let previous: CreditAccount[] = [];
  for (const p of parts) {
    // Neighbouring parts share ONE page, so an overlap copy can only be one of the last accounts of
    // the previous part AND one of the first accounts of this one, matched one-to-one (Nov 6, 2026 —
    // a client: four closed $0 loans ending 0321 in different parts were merged into each other, so
    // look-alike accounts far apart vanished). Rows within one part are never merged here.
    const tail = previous.slice(-PART_OVERLAP_ACCOUNTS);
    const used = new Set<CreditAccount>();
    const current: CreditAccount[] = [];
    p.file.accounts.forEach((raw, idx) => {
      const a: CreditAccount = { ...raw, bureaus: { ...raw.bureaus } };
      const twin = idx < PART_OVERLAP_ACCOUNTS ? tail.find((o) => !used.has(o) && samePartAccount(o, a)) : undefined;
      if (!twin) {
        accounts.push(a);
        current.push(a);
        return;
      }
      used.add(twin);
      for (const b of BUREAUS) {
        const t = a.bureaus[b];
        if (!t) continue;
        twin.bureaus[b] = twin.bureaus[b] ? mergeTradeline(twin.bureaus[b]!, t) : t;
      }
      if (!twin.mask && a.mask) twin.mask = a.mask;
      if (twin.highCredit == null && a.highCredit != null) twin.highCredit = a.highCredit;
      if (twin.monthlyPayment == null && a.monthlyPayment != null) twin.monthlyPayment = a.monthlyPayment;
      if (!twin.headerStatus && a.headerStatus) twin.headerStatus = a.headerStatus;
    });
    previous = current.length ? current : previous;
  }
  // Neighbouring parts share a page, so an inquiry can be read twice — but a lender can also pull twice
  // the same day (Nov 12, 2026 audit: the read was one short of the printed total on every such bureau).
  // Keep as many copies of a date + creditor + bureau as the part that lists it most often has.
  const qKey = (q: CreditInquiry) => `${String(q.date).trim()}|${creditorKey(q.creditor)}|${q.bureau ?? ""}`;
  const allowed = new Map<string, number>();
  for (const p of parts) {
    const inPart = new Map<string, number>();
    for (const q of p.file.inquiries) inPart.set(qKey(q), (inPart.get(qKey(q)) ?? 0) + 1);
    for (const [k, n] of inPart) allowed.set(k, Math.max(allowed.get(k) ?? 0, n));
  }
  const usedQ = new Map<string, number>();
  const inquiries = parts.flatMap((p) => p.file.inquiries).filter((q) => {
    const k = qKey(q);
    const n = usedQ.get(k) ?? 0;
    if (n >= (allowed.get(k) ?? 1)) return false;
    usedQ.set(k, n + 1);
    return true;
  });
  const seenI = new Set<string>();
  const identityFlags = parts.flatMap((p) => p.file.identityFlags ?? []).filter((f) => {
    const k = `${f.bureau ?? ""}|${f.field}|${f.detail.toUpperCase().replace(/\s+/g, " ").trim()}`;
    if (seenI.has(k)) return false;
    seenI.add(k);
    return true;
  });
  const base = parts[0].file;
  const merged = {
    ...base,
    reportDate: first((f) => f.reportDate),
    scores: perBureau((f) => f.scores),
    scoreRatings: perBureau((f) => f.scoreRatings as Partial<Record<Bureau, string | null>> | undefined),
    vantageScores: perBureau((f) => f.vantageScores),
    borrowerName: first((f) => f.borrowerName),
    borrowerAddress: first((f) => f.borrowerAddress),
    lender: first((f) => f.lender),
    summary: first((f) => f.summary),
    scoreModel: first((f) => f.scoreModel),
    lenderSimulation: first((f) => (f as { lenderSimulation?: string | null }).lenderSimulation),
    scoreReasonCodes: [...new Set(parts.flatMap((p) => p.file.scoreReasonCodes ?? []))],
    publicRecordsReported: parts.some((p) => p.file.publicRecordsReported === true) ? true : first((f) => f.publicRecordsReported),
    accounts: base.reportFormat === "merged" ? accounts : consolidateSplitAccounts(accounts),
    readEntries: accounts.length,
    inquiries,
    identityFlags,
    warnings: [...new Set(parts.flatMap((p) => p.file.warnings ?? []))],
    unreadablePages: [...new Set(parts.flatMap((p) => (p.file.unreadablePages ?? []).map((n) => n + p.firstPage)))].sort((x, y) => x - y),
  };
  return merged as F;
}
