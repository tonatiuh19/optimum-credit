/**
 * Progress Report reads — scenario matrix (synthetic data only, no client files).
 *
 * Every supported layout (SmartCredit / IdentityIQ, MyFreeScoreNow, myFICO,
 * lender tri-merge) × every read condition we have seen in production:
 * complete, half-loaded (blank account pages), names without details, missing
 * entries, merged per-bureau copies, legacy reads (no readEntries), boundary
 * tolerances, no summary. Plus the report-date rules (printed date wins over the
 * browser print header) and the blank-page guard.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import { incompleteSmartCreditPrint, normalizeStoredRead, preferSkeletonReportDate } from "./creditFileExtract";
import {
  pv2AccountHint,
  pv2DetectReportFormat,
  pv2ParsePullSummary,
  pv2SummaryShortfall,
  PV2_SUMMARY_PARSER_VERSION,
  type Pv2PullSummary,
  type Pv2ReportFormat,
} from "./progressReportV2";

// ── synthetic report text, one generator per layout ─────────────────────────

type Per = Record<Bureau, number>;
const per = (tu: number, ex: number, eq: number): Per => ({ TU: tu, EX: ex, EQ: eq });
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const row = (p: Per, f: (n: number) => string = String) => `${f(p.TU)} \t${f(p.EX)} \t${f(p.EQ)}`;

function smartCreditText(o: { total: Per; open: Per; balances: Per; inquiries: Per; limit: number; date: string; brand?: "Ultra 4K 3B Report" | "IdentityIQ" }): string {
  const closed = per(o.total.TU - o.open.TU, o.total.EX - o.open.EX, o.total.EQ - o.open.EQ);
  return [
    o.brand === "IdentityIQ" ? "IdentityIQ 3B Report" : "Ultra 4K 3B Report",
    "Summary",
    "Total Accounts",
    "Inquiries (2 Years)",
    `TransUnion® \t${money(1000)} \t${money(o.limit)} \t10%`,
    `Experian® \t${money(1000)} \t${money(o.limit)} \t10%`,
    `Equifax® \t${money(1000)} \t${money(o.limit)} \t10%`,
    "TransUnion® \tExperian® \tEquifax®",
    "620 \t590 \t660",
    `${o.date} \t${o.date} \t${o.date}`,
    row(o.total),
    row(o.open),
    row(closed),
    row(per(0, 0, 0)),
    row(per(0, 0, 0)),
    row(o.balances, money),
    row(per(200, 200, 200), money),
    row(per(0, 0, 0)),
    row(o.inquiries),
    // Browser print header — never the report date.
    "10/24/26, 9:45 AM \tUltra 4K 3B Report",
  ].join("\n");
}

function mfsnText(o: { toc: number; open: Per; inquiries: Per; collections: Per; date: string; notPulled?: Bureau }): string {
  const tocLines = Array.from({ length: o.toc }, (_, i) => (i < o.toc / 2 ? `2.${i + 1} Card Lender ${i} ${3 + i}` : `5.${i + 1} Other Lender ${i} ${40 + i}`));
  const table = (open: number) => [
    "Account Type Open With Balance Total Balance Available Credit Limit Debt-To-Credit Payment",
    "Revolving 1 1 $500 $1,500 $2,000 25% $25",
    `Total ${open} ${open} $9,000 $1,500 $12,000 75% $300`,
  ];
  return [
    "Three Bureau Credit Report",
    "2. Revolving Accounts 3",
    "5. Other Accounts 45",
    ...tocLines,
    "11. Collections 60",
    "Equifax Accounts Summary",
    "Report Date August 07, 2026 August 07, 2026 August 07, 2026".replace(/August 07, 2026/g, o.date),
    ...(o.notPulled
      ? [
          // Scrambled print text (a client, Oct 26): an empty table, the missing bureau's notice, then two tables.
          "Account Type Open With Balance Total Balance Available Credit Limit Debt-To-Credit Payment",
          "Revolving N/A N/A N/A N/A N/A N/A N/A",
          "Experian Accounts Summary",
          `${{ TU: "TransUnion", EX: "Experian", EQ: "Equifax" }[o.notPulled]} Accounts Summary`,
          `* You currently have no ${{ TU: "TransUnion", EX: "Experian", EQ: "Equifax" }[o.notPulled]} Accounts Summary on your credit file.`,
          ...(["EQ", "EX", "TU"] as Bureau[]).filter((b) => b !== o.notPulled).flatMap((b) => table(o.open[b])),
        ]
      : [...table(o.open.EQ), ...table(o.open.EX), ...table(o.open.TU)]),
    "Equifax Experian TransUnion",
    `Inquiries ${o.inquiries.EQ} ${o.inquiries.EX} ${o.inquiries.TU}`,
    "Public Records 0 0 0",
    `Collections ${o.collections.EQ} ${o.collections.EX} ${o.collections.TU}`,
  ].join("\n");
}

function myficoText(o: { blocks: number; asOf: string }): string {
  return [
    "FICO® SCORE 3B REPORT",
    `AS OF ${o.asOf}`,
    "9/15/26, 3:50 AM \tmyFICO 3-Bureau Report - printable",
    ...Array.from({ length: o.blocks }, (_, i) => `Lender ${i}\nLast Updated \t– \t08/06/2026`),
  ].join("\n");
}

function trimergeText(o: { total: number; open: number; collections: number; ordered: string }): string {
  return [
    "Report ID: 1",
    "Repositories: TUC/EXP/EQX",
    `Client Code: X-1 Ordered: ${o.ordered}`,
    "FICO Score 4",
    "Credit Summary",
    `Totals ${o.total} ${o.open} 1 $500 $5 $80,000 $10,000 4 5 3 23`,
    "Public Records:",
    "Collections/Charge-offs:",
    "Bankruptcy:",
    "0",
    String(o.collections),
    "No",
  ].join("\n");
}

// ── synthetic reads ─────────────────────────────────────────────────────────

const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: null,
  dateOpened: "01/2015", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
  creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
  lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...o,
});

/** `counts` accounts per bureau; each account's balance = `balance`. */
function readOf(counts: Per, balance: number, extra: Partial<CreditFile> = {}): CreditFile {
  const n = Math.max(counts.TU, counts.EX, counts.EQ);
  const accounts: CreditAccount[] = Array.from({ length: n }, (_, i) => ({
    creditor: `LENDER ${i}`,
    mask: String(1000 + i),
    section: "revolving",
    headerStatus: null,
    confident: true,
    bureaus: Object.fromEntries((["TU", "EX", "EQ"] as Bureau[]).filter((b) => i < counts[b]).map((b) => [b, tl({ balance, creditLimit: 5000 })])),
  }));
  return { provider: "unknown", reportDate: "10/24/2026", scores: { TU: 620, EX: 590, EQ: 660 }, accounts, inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [], ...extra };
}

// ── parsing: every layout → its own summary + printed date ──────────────────

describe("each layout parses its own summary and printed report date", () => {
  const cases: Array<{ name: string; text: string; format: Pv2ReportFormat; date: string; expect: (s: Pv2PullSummary) => void }> = [
    {
      name: "SmartCredit",
      text: smartCreditText({ total: per(33, 33, 39), open: per(8, 6, 7), balances: per(345316, 4014, 344298), inquiries: per(3, 3, 4), limit: 14624, date: "10/22/2026" }),
      format: "smartcredit",
      date: "10/22/2026",
      expect: (s) => {
        expect(s.perBureau.EQ).toMatchObject({ totalAccounts: 39, openAccounts: 7, closedAccounts: 32, balances: 344298, inquiries2y: 4 });
        expect(s.revolving.TU).toEqual({ used: 1000, limit: 14624 });
      },
    },
    {
      name: "IdentityIQ (same layout family)",
      text: smartCreditText({ total: per(20, 18, 19), open: per(5, 5, 5), balances: per(9000, 9000, 9000), inquiries: per(1, 1, 1), limit: 5000, date: "09/01/2026", brand: "IdentityIQ" }),
      format: "identityiq",
      date: "09/01/2026",
      expect: (s) => expect(s.perBureau.EX!.totalAccounts).toBe(18),
    },
    {
      name: "MyFreeScoreNow",
      text: mfsnText({ toc: 24, open: per(9, 3, 10), inquiries: per(2, 7, 0), collections: per(7, 7, 7), date: "August 07, 2026" }),
      format: "mfsn",
      date: "08/07/2026",
      expect: (s) => {
        expect(s.accountsPrinted).toBe(24);
        expect(s.perBureau.EQ).toMatchObject({ openAccounts: 10, inquiries2y: 0, collections: 7 });
        expect(s.perBureau.TU).toMatchObject({ openAccounts: 9, inquiries2y: 2 });
      },
    },
    {
      name: "myFICO (AS OF, not the print header)",
      text: myficoText({ blocks: 11, asOf: "8/25/2026" }),
      format: "myfico",
      date: "08/25/2026",
      expect: (s) => expect(s.accountsPrinted).toBe(11),
    },
    {
      name: "lender tri-merge (prints FICO 3B too — must not be read as myFICO)",
      text: trimergeText({ total: 25, open: 8, collections: 6, ordered: "09/23/2026" }),
      format: "trimerge",
      date: "09/23/2026",
      expect: (s) => expect(s.merged).toEqual({ totalAccounts: 25, openAccounts: 8, publicRecords: 0, collections: 6 }),
    },
  ];
  it.each(cases)("$name", ({ text, format, date, expect: check }) => {
    expect(pv2DetectReportFormat(text)).toBe(format);
    const s = pv2ParsePullSummary(text)!;
    expect(s.format).toBe(format);
    expect(s.reportDate).toBe(date);
    check(s);
    // The reader is told the report's own count (so it returns every account).
    expect(pv2AccountHint(s)).toMatch(/return (every one of them|all \d+)/);
  });

  it.each([
    ["empty text", ""],
    ["unrelated document", "Invoice #123\nTotal due $50"],
    ["SmartCredit labels without the value block", "Total Accounts\nInquiries (2 Years)\nUltra 4K 3B Report"],
  ])("no summary when the layout prints none: %s", (_n, text) => {
    const s = pv2ParsePullSummary(text);
    expect(s === null || (!s.accountsPrinted && !s.merged && Object.values(s.perBureau).every((v) => v == null))).toBe(true);
  });
});

// ── half-loaded / missing accounts: every layout × every condition ──────────

const SC = pv2ParsePullSummary(smartCreditText({ total: per(32, 33, 39), open: per(8, 6, 14), balances: per(350000, 351000, 352000), inquiries: per(3, 6, 5), limit: 13524, date: "06/19/2026" }))!;
const SC_SMALL = pv2ParsePullSummary(smartCreditText({ total: per(5, 5, 5), open: per(1, 1, 1), balances: per(500, 400, 300), inquiries: per(0, 0, 0), limit: 500, date: "06/19/2026" }))!;
const MFSN = pv2ParsePullSummary(mfsnText({ toc: 24, open: per(9, 3, 10), inquiries: per(2, 7, 0), collections: per(7, 7, 7), date: "August 07, 2026" }))!;
// TransUnion not pulled that month (no score, no accounts) — a client June Before.
const MFSN_NO_TU = pv2ParsePullSummary(mfsnText({ toc: 19, open: per(0, 2, 8), inquiries: per(0, 15, 21), collections: per(0, 4, 6), date: "June 15, 2026", notPulled: "TU" }))!;
const FICO = pv2ParsePullSummary(myficoText({ blocks: 11, asOf: "8/25/2026" }))!;
const TRI = pv2ParsePullSummary(trimergeText({ total: 25, open: 8, collections: 6, ordered: "09/23/2026" }))!;

describe("shortfall matrix (blocks the read before any report is built)", () => {
  const rows: Array<[string, Pv2PullSummary | null, CreditFile, RegExp | null]> = [
    // SmartCredit / IdentityIQ: per-bureau totals + balances
    ["SC complete", SC, readOf(per(32, 33, 39), 11000), null],
    ["SC half-loaded (Edith's baseline shape)", SC, readOf(per(11, 11, 12), 30000), /^TU 11 of 32, EX 11 of 33, EQ 12 of 39/],
    ["SC names listed, details never loaded (balances $0)", SC, readOf(per(32, 33, 39), 0), /^TU balances \$0 of \$350,000, EX balances \$0 of \$351,000, EQ balances \$0 of \$352,000$/],
    ["SC boundary: exactly 90% of the accounts", SC, readOf(per(29, 30, 36), 11000), null],
    ["SC just under 90% on one bureau", SC, readOf(per(28, 33, 39), 11000), /^TU 28 of 32$/],
    ["SC boundary: balances at 50%", SC, readOf(per(32, 33, 39), 5500), null],
    ["SC small file: $0 balances under $1,000 are not a shortfall", SC_SMALL, readOf(per(5, 5, 5), 0), null],
    ["SC more accounts than the summary (never a shortfall)", SC, readOf(per(40, 40, 45), 11000), null],
    // MyFreeScoreNow: table of contents vs entries before same-account copies merge
    ["MFSN complete: 24 entries merge to 18 accounts", MFSN, readOf(per(18, 18, 18), 1000, { readEntries: 24 }), null],
    ["MFSN reader skipped a section (18 of 24 entries)", MFSN, readOf(per(18, 18, 18), 1000, { readEntries: 18 }), /^18 of 24 accounts$/],
    ["MFSN legacy read (no readEntries): merged count not comparable", MFSN, readOf(per(18, 18, 18), 1000), null],
    ["MFSN: a bureau with open accounts in its summary but nothing read (TU never read) still blocks", MFSN, readOf(per(0, 18, 18), 1000, { readEntries: 24 }), /^TU 0 of 9 open accounts$/],
    ["MFSN: bureau not pulled ('no TransUnion Accounts Summary') + 0 TU read → complete, not blocked", MFSN_NO_TU, readOf(per(0, 11, 17), 1000, { readEntries: 19 }), null],
    ["MFSN: bureau not pulled but the reader skipped a section → still blocked", MFSN_NO_TU, readOf(per(0, 8, 12), 1000, { readEntries: 12 }), /^12 of 19 accounts$/],
    // myFICO: account blocks
    ["myFICO complete", FICO, readOf(per(11, 11, 11), 1000, { readEntries: 11 }), null],
    ["myFICO missing blocks", FICO, readOf(per(5, 5, 5), 1000, { readEntries: 5 }), /^5 of 11 accounts$/],
    // tri-merge: combined totals (rows are never merged)
    ["tri-merge complete", TRI, readOf(per(25, 25, 25), 1000), null],
    ["tri-merge within 10%", TRI, readOf(per(23, 23, 23), 1000), null],
    ["tri-merge missing accounts", TRI, readOf(per(20, 20, 20), 1000), /^20 of 25 accounts$/],
    // no summary printed → nothing to compare
    ["no summary", null, readOf(per(1, 1, 1), 0), null],
  ];
  it.each(rows)("%s", (_name, summary, file, expected) => {
    const got = pv2SummaryShortfall(file, summary);
    if (expected) expect(got).toMatch(expected);
    else expect(got).toBeNull();
  });
});

describe("blank-page guard (SmartCredit print saved while loading)", () => {
  const sk = (provider: string, imagePages: number, totalPages: number) => ({ provider, imagePages, totalPages }) as CreditFile;
  it.each([
    ["≤3 accounts, 7 of 10 pages blank", { accounts: [] }, sk("smartcredit", 7, 10), true],
    ["3 accounts, 12 of 18 pages blank", { accounts: [1, 2, 3] }, sk("smartcredit", 12, 18), true],
    ["4 accounts (real file, not the guard's job)", { accounts: [1, 2, 3, 4] }, sk("smartcredit", 12, 18), false],
    ["blank pages under 40%", { accounts: [] }, sk("smartcredit", 3, 10), false],
    ["fewer than 3 blank pages", { accounts: [] }, sk("smartcredit", 2, 4), false],
    ["other provider", { accounts: [] }, sk("unknown", 7, 10), false],
    ["no skeleton", { accounts: [] }, null, false],
  ])("%s", (_n, file, skel, blocked) => {
    const r = incompleteSmartCreditPrint(file as { accounts: unknown[] }, skel);
    expect(!!r).toBe(blocked);
    if (blocked) expect(r).toMatch(/before SmartCredit finished loading .* Print → Save as PDF/);
  });
});

describe("report date: the date printed in the report body always wins", () => {
  const skel = (provider: string, reportDate: string | null, printed?: string | null) =>
    ({ provider, reportDate, ...(printed !== undefined ? { pullSummary2: { reportDate: printed } } : {}) }) as unknown as CreditFile;
  it.each([
    ["AI read the print header; layout summary has the date", "10/24/2026", skel("unknown", null, "08/25/2026"), "08/25/2026"],
    ["SmartCredit text parser date (no layout summary)", "10/24/2026", skel("smartcredit", "11/19/2025"), "11/19/2025"],
    ["layout summary wins over the text parser", "10/24/2026", skel("smartcredit", "11/19/2025", "11/20/2025"), "11/20/2025"],
    ["malformed printed date is ignored", "10/24/2026", skel("smartcredit", "11/19/2025", "Aug 2026"), "11/19/2025"],
    ["unknown layout, nothing printed: keep the AI date", "03/20/2026", skel("unknown", "11/19/2025"), "03/20/2026"],
    ["no skeleton", "03/20/2026", null, "03/20/2026"],
  ])("%s", (_n, aiDate, s, expected) => {
    expect(preferSkeletonReportDate({ reportDate: aiDate }, s).reportDate).toBe(expected);
  });
});

describe("cached summaries carry the parser version", () => {
  it("every parsed layout is stamped with the current parser version", () => {
    for (const s of [SC, MFSN, MFSN_NO_TU, FICO, TRI]) expect(s.parserVersion).toBe(PV2_SUMMARY_PARSER_VERSION);
  });
});

describe("same-bureau collection twins (collector name + client name, MyFreeScoreNow)", () => {
  const acc = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Bureau[], o: Partial<BureauTradeline>): CreditAccount => ({
    creditor, mask, section, headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(o)])),
  });
  const coll = { accountStatus: "Collection Account", paymentStatus: "Collection" };
  it.each([
    ["collector + client, same bureau, same last 4 + balance → one", [acc("CREDIT COLLECTION SE", "38", "installment", ["EQ"], { ...coll, balance: 99 }), acc("SENTRY SELECT I", "38", "collection", ["EQ"], { ...coll, balance: 99 })], 1],
    ["three pairs (Juan's Before) → three", [99, 109, 126].flatMap((b, i) => [acc("CREDIT COLLECTION SE", `6${i}`, "installment", ["EQ"], { ...coll, balance: b }), acc("SENTRY IN A MUT", `6${i}`, "collection", ["EQ"], { ...coll, balance: b })]), 3],
    ["same last 4 + balance but NOT collections (two real cards) → two", [acc("BANK A", "1234", "revolving", ["EQ"], { balance: 500 }), acc("BANK B", "1234", "revolving", ["EQ"], { balance: 500 })], 2],
    ["collection + a regular account with the same last 4 + balance → two", [acc("COLLECTOR", "1234", "collection", ["EQ"], { ...coll, balance: 500 }), acc("BANK", "1234", "revolving", ["EQ"], { balance: 500 })], 2],
    ["two collections, same last 4, different balances → two", [acc("COLLECTOR A", "1234", "collection", ["EQ"], { ...coll, balance: 500 }), acc("COLLECTOR B", "1234", "collection", ["EQ"], { ...coll, balance: 700 })], 2],
    ["$0 collections are never merged on last 4 alone → two", [acc("COLLECTOR A", "1234", "collection", ["EQ"], { ...coll, balance: 0 }), acc("COLLECTOR B", "1234", "collection", ["EQ"], { ...coll, balance: 0 })], 2],
    ["split across bureaus (existing rule) still merges → one", [acc("COLLECTOR", "77", "collection", ["EQ"], { ...coll, balance: 300 }), acc("ORIGINAL", "77", "other", ["EX"], { ...coll, balance: 300 })], 1],
  ] as Array<[string, CreditAccount[], number]>)("%s", (_n, accounts, n) => {
    const file = readOf(per(0, 0, 0), 0, { accounts });
    expect(normalizeStoredRead(file).accounts).toHaveLength(n);
    expect(file.accounts).toHaveLength(accounts.length); // the stored read is never mutated
  });
  it("tri-merge rows are never merged", () => {
    const rows = [acc("A", "38", "collection", ["EQ"], { ...coll, balance: 99 }), acc("B", "38", "collection", ["EQ"], { ...coll, balance: 99 })];
    expect(normalizeStoredRead(readOf(per(0, 0, 0), 0, { accounts: rows, reportFormat: "merged" })).accounts).toHaveLength(2);
  });
});
