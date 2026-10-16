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
} from "./creditFile";

const BUREAU_KEYS = { TU: "transunion", EX: "experian", EQ: "equifax" } as const;

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_NUMBER = { type: ["number", "null"] } as const;
const NULLABLE_INT = { type: ["integer", "null"] } as const;

/** Lean per-bureau fields (null when that bureau does not report the account). */
const BUREAU_TRADELINE_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    date_opened: { ...NULLABLE_STRING, description: "MM/DD/YYYY or MM/YYYY" },
    date_last_activity: NULLABLE_STRING,
    balance: NULLABLE_NUMBER,
    credit_limit: { ...NULLABLE_NUMBER, description: "Credit limit, or original/high amount for loans" },
    past_due: NULLABLE_NUMBER,
    account_type: { ...NULLABLE_STRING, description: "e.g. Credit Card, Auto Loan, Collection, Installment" },
    account_status: { ...NULLABLE_STRING, description: "Open / Closed / Paid / Derogatory …" },
    payment_status: { ...NULLABLE_STRING, description: "Current, Late 30 Days, Charge-off, Collection …" },
    remarks: { ...NULLABLE_STRING, description: "Creditor remarks verbatim, incl. any dispute notation" },
    dispute_status: { ...NULLABLE_STRING, description: "Dispute Status field verbatim" },
    late_30: NULLABLE_INT,
    late_60: NULLABLE_INT,
    late_90: NULLABLE_INT,
    closed_date: { ...NULLABLE_STRING, description: "Closed date if this bureau prints one" },
    payment_grid_lates: {
      type: "array",
      items: { type: "string" },
      description: 'Every NON-OK cell of this bureau\'s payment-history grid as "MM/YYYY:CODE" (CODE = 30, 60, 90, 120, 150, CO, C, R, F, B). Empty when all cells are OK/blank.',
    },
  },
  required: [
    "date_opened",
    "date_last_activity",
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
    "closed_date",
    "payment_grid_lates",
  ],
} as const;

/** JSON schema for structured outputs (output_config.format). */
export const CREDIT_FILE_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    report_date: { ...NULLABLE_STRING, description: "Report pull date MM/DD/YYYY" },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        transunion: NULLABLE_INT,
        experian: NULLABLE_INT,
        equifax: NULLABLE_INT,
      },
      required: ["transunion", "experian", "equifax"],
    },
    score_model: { ...NULLABLE_STRING, description: "e.g. VantageScore 3.0" },
    score_ratings: {
      type: "object",
      additionalProperties: false,
      description: "Rating word printed next to each score (e.g. Fair, Good, Very Good, Excellent); null if none printed",
      properties: {
        transunion: NULLABLE_STRING,
        experian: NULLABLE_STRING,
        equifax: NULLABLE_STRING,
      },
      required: ["transunion", "experian", "equifax"],
    },
    identity_variations: {
      type: "array",
      description:
        "Personal-information differences between bureaus (name variations, SSN not matching the other bureaus, date of birth, address). NEVER include SSN digits.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          bureau: { type: "string", enum: ["transunion", "experian", "equifax"] },
          field: { type: "string", enum: ["name", "ssn", "dob", "address"] },
          detail: { type: "string", description: "Short description, no SSN digits" },
        },
        required: ["bureau", "field", "detail"],
      },
    },
    accounts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          creditor: { type: "string" },
          original_creditor: NULLABLE_STRING,
          account_mask: NULLABLE_STRING,
          section: {
            type: "string",
            enum: ["revolving", "installment", "mortgage", "collection", "other", "unknown"],
          },
          transunion: BUREAU_TRADELINE_SCHEMA,
          experian: BUREAU_TRADELINE_SCHEMA,
          equifax: BUREAU_TRADELINE_SCHEMA,
        },
        required: [
          "creditor",
          "original_creditor",
          "account_mask",
          "section",
          "transunion",
          "experian",
          "equifax",
        ],
      },
    },
    inquiries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          creditor: { type: "string" },
          bureau: { type: "string", enum: ["transunion", "experian", "equifax"] },
        },
        required: ["date", "creditor", "bureau"],
      },
    },
    public_records_count: NULLABLE_INT,
    unreadable_pages: {
      type: "array",
      items: { type: "integer" },
      description: "1-based page numbers you could not read",
    },
  },
  required: [
    "report_date",
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

export const CREDIT_FILE_EXTRACTION_PROMPT = `You are reading a consumer credit report (any provider: SmartCredit, IdentityIQ, MyFreeScoreNow, a bureau report, a scan or a photo). It may cover one, two or three bureaus (TransUnion, Experian, Equifax). Some pages may be images — read them too.
Extract EVERY tradeline account (open, closed, paid, collections, charge-offs) exactly as printed. One entry per account; put each bureau's values under transunion / experian / equifax, or null when that bureau does not report the account.
Rules:
- Copy values verbatim; never infer, estimate, or fill missing values. Use null for "——", "--", blank, or not reported.
- Money as plain numbers (no $ or commas). Dates as printed (MM/DD/YYYY or MM/YYYY).
- late_30 / late_60 / late_90 are the "Days Late" counts for that bureau.
- remarks: creditor remarks verbatim (keep dispute notations such as "Consumer disputes", "disputed, meets FCRA requirements").
- payment_grid_lates: read each bureau's payment-history grid; list every late/derogatory cell as "MM/YYYY:CODE". This catches lates the Status field and Days Late summary miss.
- score_ratings: the rating word the report prints for each score (do not compute one).
- identity_variations: compare names, SSN, date of birth and addresses across bureaus; list each bureau whose data differs. Never write SSN digits — say e.g. "SSN differs from Experian/TransUnion".
- Inquiries: every hard inquiry listed, one entry per bureau.
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
        content: [fileBlock, { type: "text", text: CREDIT_FILE_EXTRACTION_PROMPT }],
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
    dateReported: null,
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
export function parseCreditFileExtraction(
  raw: string | Record<string, unknown>,
  provider: CreditFileProvider,
): CreditFile & { scoreModel: string | null; unreadablePages: number[] } {
  const data: any = typeof raw === "string" ? JSON.parse(raw) : raw;
  const accounts: CreditAccount[] = (Array.isArray(data?.accounts) ? data.accounts : [])
    .filter((a: any) => a && str(a.creditor))
    .map((a: any) => {
      const bureaus: Partial<Record<Bureau, BureauTradeline>> = {};
      for (const b of BUREAUS) {
        const tl = toTradeline(a[BUREAU_KEYS[b]]);
        if (tl) bureaus[b] = tl;
      }
      const section = SECTIONS.includes(a.section) ? a.section : "unknown";
      return {
        creditor: str(a.creditor)!,
        mask: str(a.account_mask),
        section,
        headerStatus: str(a.original_creditor)
          ? `Original creditor: ${str(a.original_creditor)}`
          : null,
        bureaus,
        confident: Object.keys(bureaus).length > 0,
      } satisfies CreditAccount;
    });
  const inquiries: CreditInquiry[] = (Array.isArray(data?.inquiries) ? data.inquiries : [])
    .filter((q: any) => q && str(q.date) && str(q.creditor))
    .map((q: any) => ({
      date: str(q.date)!,
      creditor: str(q.creditor)!,
      bureau: (q.bureau === "transunion" ? "TU" : q.bureau === "experian" ? "EX" : "EQ") as Bureau,
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
        bureau: (v.bureau === "transunion" ? "TU" : v.bureau === "experian" ? "EX" : "EQ") as Bureau,
        field: v.field,
        // Defense in depth: strip any digit run that could be an SSN.
        detail: String(v.detail || "").replace(/\d{3,}[-\s]?\d*/g, "•••").slice(0, 160),
      })),
    unreadablePages,
  };
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
