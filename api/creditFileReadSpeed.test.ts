/**
 * Read speed (Oct 27, 2026): split planning, merging split reads back into one
 * read, and the reader fingerprint that gates reuse. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import {
  buildCreditFileExtractionParams,
  CREDIT_FILE_EXTRACTION_PROMPT,
  creditFileExtractVersion,
  creditFilePartNote,
  mergeCreditFileParts,
  planCreditFileParts,
} from "./creditFileExtract";

const tl = (o: Partial<BureauTradeline> = {}): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: "10/01/2026",
  dateOpened: "01/2021", balance: 100, closedDate: null, accountRating: null, description: null, disputeStatus: null,
  creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
  lastPayment: null, termLength: null, pastDue: 0, accountType: "Credit Card", paymentFrequency: null, creditLimit: 1000,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...o,
});
const acct = (creditor: string, mask: string | null, bureaus: Bureau[], o: Partial<BureauTradeline> = {}): CreditAccount => ({
  creditor, mask, section: "revolving", headerStatus: null, confident: true,
  bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(o)])),
});
const file = (o: Partial<CreditFile & { scoreModel: string | null; unreadablePages: number[] }> = {}): CreditFile & { scoreModel: string | null; unreadablePages: number[] } => ({
  provider: "smartcredit", reportDate: null, scores: { TU: null, EX: null, EQ: null }, accounts: [], inquiries: [],
  publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [], identityFlags: [],
  scoreModel: null, unreadablePages: [],
  ...o,
});
const inq = (creditor: string, bureau: Bureau | null, date: string): CreditInquiry => ({ creditor, bureau, date, matchedAccount: null });

describe("planCreditFileParts", () => {
  it.each([
    ["tiny file", { pages: 4 }, 1],
    ["7 pages, few accounts", { pages: 7, estAccounts: 12 }, 1],
    ["9 pages, few accounts", { pages: 9, estAccounts: 20 }, 1],
    ["9 pages but 44 accounts", { pages: 9, estAccounts: 44 }, 2],
    ["17 pages", { pages: 17 }, 2],
    ["24 pages", { pages: 24, estAccounts: 23 }, 3],
    ["40 pages, 78 accounts", { pages: 40, estAccounts: 78 }, 4],
    ["200 pages → capped", { pages: 200 }, 4],
    ["forced split of a short file", { pages: 8, forceSplit: true }, 2],
    ["forced split, too short to split", { pages: 5, forceSplit: true }, 1],
    ["unknown page count", { pages: 0 }, 1],
  ] as Array<[string, Parameters<typeof planCreditFileParts>[0], number]>)("%s → %i part(s)", (_n, opts, n) => {
    const plan = planCreditFileParts(opts);
    expect(plan).toHaveLength(n);
    if (opts.pages > 0) {
      // Every page is covered, in order, from the first to the last.
      expect(plan[0].start).toBe(0);
      expect(plan[plan.length - 1].end).toBe(opts.pages - 1);
      for (let i = 1; i < plan.length; i++) {
        // Neighbours share exactly one page (an account across a page break is whole in one part).
        expect(plan[i].start).toBe(plan[i - 1].end);
        expect(plan[i].end - plan[i].start + 1).toBeGreaterThanOrEqual(4);
      }
    }
  });
  it("part note names the page range and forbids inventing", () => {
    const note = creditFilePartNote({ start: 8, end: 16 }, 1, 3, 24);
    expect(note).toContain("pages 9-17 of a 24-page report (part 2 of 3)");
    expect(note).toMatch(/never invent/);
  });
});

describe("buildCreditFileExtractionParams", () => {
  const text = (p: Record<string, any>) => p.messages[0].content[1].text as string;
  it("a part note replaces the whole-report account hint", () => {
    const p = buildCreditFileExtractionParams({ fileBase64: "x", model: "m", accountHint: "This report lists 44 accounts", partNote: "pages 1-9" });
    expect(text(p)).toBe(`${CREDIT_FILE_EXTRACTION_PROMPT}\n- pages 1-9`);
  });
  it("without a part note the hint and plain prompt are unchanged", () => {
    expect(text(buildCreditFileExtractionParams({ fileBase64: "x", model: "m", accountHint: "H" }))).toBe(`${CREDIT_FILE_EXTRACTION_PROMPT}\n- H`);
    expect(text(buildCreditFileExtractionParams({ fileBase64: "x", model: "m" }))).toBe(CREDIT_FILE_EXTRACTION_PROMPT);
  });
});

describe("creditFileExtractVersion", () => {
  it("is stable, fits the column, and changes with the model", () => {
    const a = creditFileExtractVersion("claude-sonnet-4-6");
    expect(a).toBe(creditFileExtractVersion("claude-sonnet-4-6"));
    expect(a.length).toBeLessThanOrEqual(24);
    expect(a).not.toBe(creditFileExtractVersion("claude-opus-5-5"));
  });
});

describe("mergeCreditFileParts", () => {
  it("report-level fields: first value wins; scores fill in per bureau from any part", () => {
    const m = mergeCreditFileParts([
      { file: file({ reportDate: "09/23/2026", scores: { TU: 520, EX: null, EQ: null }, borrowerName: "JANE DOE" }), firstPage: 0 },
      { file: file({ reportDate: null, scores: { TU: 999, EX: 522, EQ: 544 } }), firstPage: 8 },
    ]);
    expect(m.reportDate).toBe("09/23/2026");
    expect(m.scores).toEqual({ TU: 520, EX: 522, EQ: 544 });
    expect(m.borrowerName).toBe("JANE DOE");
  });
  it("the overlap page's copy of an account is merged field by field (never counted twice)", () => {
    const full = acct("BANK A", "1234", ["TU", "EX", "EQ"], { balance: 500, creditLimit: 2000, dateOpened: "03/2019", remarks: "CLOSED BY GRANTOR" });
    const tail = acct("BANK A", "1234", ["EQ"], { balance: 500, creditLimit: null, dateOpened: "03/2019", remarks: null, late30: 2 });
    const m = mergeCreditFileParts([
      { file: file({ accounts: [full, acct("BANK B", "1111", ["TU"])] }), firstPage: 0 },
      { file: file({ accounts: [tail, acct("BANK C", "2222", ["EX"])] }), firstPage: 8 },
    ]);
    expect(m.accounts.map((a) => a.creditor)).toEqual(["BANK A", "BANK B", "BANK C"]);
    const a = m.accounts[0];
    expect(Object.keys(a.bureaus).filter((b) => a.bureaus[b as Bureau]).sort()).toEqual(["EQ", "EX", "TU"]);
    expect(a.bureaus.EQ!.creditLimit).toBe(2000); // kept from the fuller copy
    expect(a.bureaus.EQ!.remarks).toBe("CLOSED BY GRANTOR");
    expect(m.readEntries).toBe(3);
  });
  it("an account cut by a page break (TU/EX in one part, EQ in the next) becomes one account", () => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [acct("STORE CARD", "01", ["TU", "EX"], { balance: 823, creditLimit: 2300, dateOpened: "10/2023" })] }), firstPage: 0 },
      { file: file({ accounts: [acct("STORE CARD", null, ["EQ"], { balance: 823, creditLimit: 2300, dateOpened: "10/2023" })] }), firstPage: 8 },
    ]);
    expect(m.accounts).toHaveLength(1);
    expect(m.accounts[0].mask).toBe("01");
  });
  it.each([
    ["different account numbers", acct("BANK A", "1234", ["TU"]), acct("BANK A", "9999", ["TU"])],
    ["same bureau, different balance", acct("BANK A", "1234", ["TU"], { balance: 100 }), acct("BANK A", "1234", ["TU"], { balance: 900 })],
    ["same bureau, different open month", acct("BANK A", null, ["TU"], { dateOpened: "01/2020" }), acct("BANK A", null, ["TU"], { dateOpened: "06/2022" })],
    ["different creditors", acct("BANK A", "1234", ["TU"]), acct("BANK B", "1234", ["TU"])],
  ])("two real accounts stay two: %s", (_n, x, y) => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [x] }), firstPage: 0 },
      { file: file({ accounts: [y] }), firstPage: 8 },
    ]);
    expect(m.accounts).toHaveLength(2);
  });
  it("inquiries and personal info are de-duplicated across parts", () => {
    const m = mergeCreditFileParts([
      { file: file({ inquiries: [inq("LENDER X", "EX", "09/18/2026"), inq("LENDER Y", "TU", "08/01/2026")], identityFlags: [{ bureau: "TU", field: "name", detail: "JANE  DOE" }] }), firstPage: 0 },
      { file: file({ inquiries: [inq("Lender X", "EX", "09/18/2026"), inq("LENDER X", "EQ", "09/18/2026")], identityFlags: [{ bureau: "TU", field: "name", detail: "jane doe" }] }), firstPage: 8 },
    ]);
    expect(m.inquiries.map((q) => `${q.creditor}|${q.bureau}`)).toEqual(["LENDER X|EX", "LENDER Y|TU", "LENDER X|EQ"]);
    expect(m.identityFlags).toHaveLength(1);
  });
  it("public records: any part reporting them wins; unreadable pages are absolute", () => {
    const m = mergeCreditFileParts([
      { file: file({ publicRecordsReported: false, unreadablePages: [2] }), firstPage: 0 },
      { file: file({ publicRecordsReported: true, unreadablePages: [1, 3] }), firstPage: 8 },
    ]);
    expect(m.publicRecordsReported).toBe(true);
    expect(m.unreadablePages).toEqual([2, 9, 11]);
  });
  it("tri-merge rows are never consolidated", () => {
    const m = mergeCreditFileParts([
      { file: file({ reportFormat: "merged", accounts: [acct("BANK A", "01", ["TU"], { dateOpened: "10/2023" })] }), firstPage: 0 },
      { file: file({ reportFormat: "merged", accounts: [acct("BANK A", null, ["EX"], { dateOpened: "10/2023" })] }), firstPage: 3 },
    ]);
    expect(m.accounts).toHaveLength(2);
  });
  it("a single part passes through unchanged in shape", () => {
    const f = file({ reportDate: "01/01/2026", accounts: [acct("BANK A", "1", ["TU"])], inquiries: [inq("X", "TU", "01/01/2026")] });
    const m = mergeCreditFileParts([{ file: f, firstPage: 0 }]);
    expect(m.accounts).toHaveLength(1);
    expect(m.inquiries).toHaveLength(1);
    expect(m.reportDate).toBe("01/01/2026");
  });
  it("no parts is an error", () => expect(() => mergeCreditFileParts([])).toThrow());
});

describe("mergeCreditFileParts: never merges distinct accounts (shadow-run regressions)", () => {
  it("many BNPL loans with letter account numbers and $0 balances stay separate", () => {
    const loans = ["ZQ", "A4", "PV", "HE", "RO"].map((m) => acct("AFFIRM INC", m, ["EX"], { balance: 0, creditLimit: null, dateOpened: null }));
    const m = mergeCreditFileParts([
      { file: file({ accounts: loans.slice(0, 3) }), firstPage: 0 },
      { file: file({ accounts: loans.slice(3) }), firstPage: 8 },
    ]);
    expect(m.accounts).toHaveLength(5);
  });
  it("two rows inside ONE part are never merged by the overlap rule", () => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [acct("BANK A", null, ["TU"], { balance: 0 }), acct("BANK A", null, ["TU"], { balance: 0 })] }), firstPage: 0 },
      { file: file({ accounts: [] }), firstPage: 8 },
    ]);
    expect(m.accounts).toHaveLength(2);
  });
  it("masked numbers (XXXX1234 vs ****1234) are the same account", () => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [acct("BANK A", "XXXX1234", ["TU"], { balance: 50 })] }), firstPage: 0 },
      { file: file({ accounts: [acct("BANK A", "****1234", ["TU"], { balance: 50 })] }), firstPage: 8 },
    ]);
    expect(m.accounts).toHaveLength(1);
  });
});

describe("mergeCreditFileParts: overlap copies only across the shared page (Nov 6, 2026 — Jeser)", () => {
  // Four closed $0 student loans with the same number, one per part position; dates missing on some.
  const loan = (dateOpened: string | null) => acct("ED FINANCIAL/ESA", "0321", ["TU"], { balance: 0, creditLimit: null, accountStatus: "Closed", dateOpened });
  const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => acct(`LENDER ${tag}${i}`, String(1000 + i), ["TU"], { dateOpened: `0${(i % 9) + 1}/2015` }));

  it("look-alike accounts far from the shared page are never merged", () => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [loan("01/2014"), loan(null), ...filler(6, "a")] }), firstPage: 0 },
      { file: file({ accounts: [...filler(6, "b"), loan(null), loan("09/2016")] }), firstPage: 27 },
    ]);
    expect(m.accounts.filter((a) => a.creditor === "ED FINANCIAL/ESA")).toHaveLength(4);
    expect(m.readEntries).toBe(16);
  });

  it("each account on the shared page is merged once (one-to-one), the next look-alike stays", () => {
    const m = mergeCreditFileParts([
      { file: file({ accounts: [...filler(3, "a"), loan(null)] }), firstPage: 0 },
      { file: file({ accounts: [loan(null), loan(null), ...filler(2, "b")] }), firstPage: 27 },
    ]);
    // The first copy is the overlap of part 1's last loan; the second is a different loan.
    expect(m.accounts.filter((a) => a.creditor === "ED FINANCIAL/ESA")).toHaveLength(2);
  });

  it("an overlap copy still merges across three parts", () => {
    const a = acct("BANK A", "1234", ["TU"], { balance: 70 });
    const b = acct("BANK B", "5678", ["TU"], { balance: 80 });
    const m = mergeCreditFileParts([
      { file: file({ accounts: [...filler(5, "a"), a] }), firstPage: 0 },
      { file: file({ accounts: [{ ...a }, ...filler(5, "b"), b] }), firstPage: 9 },
      { file: file({ accounts: [{ ...b }, ...filler(2, "c")] }), firstPage: 18 },
    ]);
    expect(m.accounts.map((x) => x.creditor).filter((c) => c.startsWith("BANK"))).toEqual(["BANK A", "BANK B"]);
  });
});
