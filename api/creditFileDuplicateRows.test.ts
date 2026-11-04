/**
 * Nov 3, 2026 — two scenarios seen on real reports (no client data here):
 * 1. The read lists one account twice on the same bureaus: identical row, real balance → one
 *    account (the duplicate inflated balances and account counts). Look-alikes stay separate.
 * 2. The "Inquiries (2 Years)" self-check counts back by calendar date like the bureau summary.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import { consolidateSplitAccounts } from "./creditFileExtract";
import { PV2_SUMMARY_PARSER_VERSION, pv2BuildPdfData, pv2Diff, pv2SelfCheck, pv2WithinTwoYears, type Pv2PullSummary, type Pv2RenderStats } from "./progressReportV2";

const B: Bureau[] = ["TU", "EX", "EQ"];
const tl = (o: Partial<BureauTradeline> = {}): BureauTradeline =>
  ({ dateOpened: "08/21/2015", balance: 19000, creditLimit: null, highBalance: 25000, accountStatus: "Open", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [], ...o }) as BureauTradeline;
const acct = (creditor: string, mask: string | null, t: Partial<BureauTradeline> = {}, bureaus: Bureau[] = B, section: CreditAccount["section"] = "installment"): CreditAccount =>
  ({ creditor, mask, section, headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(t)])) }) as CreditAccount;
const run = (...rows: CreditAccount[]) => consolidateSplitAccounts(rows.map((a) => ({ ...a, bureaus: { ...a.bureaus } })));

describe("same account read twice on the same bureaus", () => {
  it("identical row with a real balance → one account (short account number)", () => {
    expect(run(acct("LOAN SERVICER INC", "0"), acct("LOAN SERVICER INC", "0"))).toHaveLength(1);
  });
  it("identical row, no account number at all → one account", () => {
    expect(run(acct("LOAN SERVICER INC", null), acct("LOAN SERVICER INC", null))).toHaveLength(1);
  });
  it.each([
    ["different balance (two loans same day)", { balance: 36000 }],
    ["different open date", { dateOpened: "09/07/2016" }],
    ["different high balance", { highBalance: 30000 }],
    ["different status", { paymentStatus: "Late 30 Days", late30: 1 }],
  ])("look-alike stays separate: %s", (_n, diff) => {
    expect(run(acct("LOAN SERVICER INC", "0"), acct("LOAN SERVICER INC", "0", diff))).toHaveLength(2);
  });
  it("$0 balance never merges (paid / transferred loans with the same name and date are separate)", () => {
    expect(run(acct("DEPT OF EDUCATION", "9", { balance: 0 }), acct("DEPT OF EDUCATION", "9", { balance: 0 }), acct("DEPT OF EDUCATION", "9", { balance: 0 }))).toHaveLength(3);
  });
  it("different account numbers stay separate", () => {
    expect(run(acct("LOAN SERVICER INC", "1234"), acct("LOAN SERVICER INC", "5678"))).toHaveLength(2);
  });
  it("different bureau sets stay separate here (the split-row rules handle those)", () => {
    expect(run(acct("LOAN SERVICER INC", "0", {}, ["TU", "EX", "EQ"]), acct("LOAN SERVICER INC", "0", {}, ["TU", "EX"]))).toHaveLength(2);
  });
  it("different creditors stay separate", () => {
    expect(run(acct("LOAN SERVICER INC", "0"), acct("OTHER LENDER", "0"))).toHaveLength(2);
  });
  it("three identical copies → one", () => {
    expect(run(acct("LOAN SERVICER INC", "0"), acct("LOAN SERVICER INC", "0"), acct("LOAN SERVICER INC", "0"))).toHaveLength(1);
  });
});

describe("2-year inquiry window by calendar date", () => {
  const d = (s: string) => new Date(s);
  it.each([
    ["two years and one day → out", "2024-08-30", "2026-08-31", false],
    ["exactly two years → in", "2024-08-31", "2026-08-31", true],
    ["yesterday → in", "2026-08-30", "2026-08-31", true],
    ["after the report date → out", "2026-09-01", "2026-08-31", false],
    ["leap day report: 02/29/2028 counts back to 02/29/2026 → 03/01/2026", "2026-02-28", "2028-02-29", false],
  ])("%s", (_n, q, asOf, want) => {
    expect(pv2WithinTwoYears(d(q), d(asOf))).toBe(want);
  });

  it("self-check: 20 read, summary 19 because one is 2 years + 1 day old → passes", () => {
    const inq = (date: string) => ({ creditor: `LENDER ${date}`, date, bureau: "EX" as Bureau, matchedAccount: null });
    const file = (date: string, inquiries: ReturnType<typeof inq>[]) =>
      ({ provider: "smartcredit", reportDate: date, scores: { TU: 600, EX: 600, EQ: 600 }, accounts: [acct("LOAN SERVICER INC", "0")], inquiries, publicRecordsReported: false, imagePages: 0, totalPages: 9, confidence: 1, warnings: [] }) as unknown as CreditFile;
    const recent = Array.from({ length: 19 }, (_, i) => inq(`0${(i % 9) + 1}/15/2025`));
    const after = file("08/31/2026", [...recent, inq("08/30/2024")]);
    const before = file("06/01/2026", recent);
    const sum = (n: number) => ({ parserVersion: PV2_SUMMARY_PARSER_VERSION, format: "smartcredit", reportDate: null, perBureau: { TU: null, EQ: null, EX: { totalAccounts: null, openAccounts: null, closedAccounts: null, balances: null, publicRecords: null, inquiries2y: n } }, revolving: { TU: null, EX: null, EQ: null } }) as Pv2PullSummary;
    const diff = pv2Diff(before, after);
    const scores = Object.fromEntries(B.map((b) => [b, { before: 600, after: 600 }])) as Record<Bureau, { before: number; after: number }>;
    const pdf = pv2BuildPdfData({ diff, clientFirstName: "A", clientName: "A B", round: 4, scores, phone: "x", site: "x" });
    const stats: Pv2RenderStats = { targetsRepresented: diff.targets.length, winsRepresented: diff.wins.length, pages: 3, croaText: "", clientText: [] };
    const c = pv2SelfCheck({ before, after, summaries: { before: sum(19), after: sum(19) }, diff, pdf, stats, recordTargets: diff.targets.length }).checks.find((x) => x.key === "inquiries")!;
    expect(c).toMatchObject({ pass: true });
  });
});
