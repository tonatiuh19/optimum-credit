/**
 * Progress Report Engine Fix Spec v1.1 (Cesar, Oct 23 2026) — engine rules on
 * fixtures (synthetic names / numbers; no client data):
 * P0-2 one state per item per bureau (aliases + servicing links), P0-3 every
 * target rendered, P0-4 new negatives stated, P0-5 projection caps, P0-6 no
 * negatives in Positives, P1-1 roadmap = Step 1, P1-4 type from status fields,
 * P1-5 inquiry normalization, P1-6 facts only, P2-3 pay-down amounts, and the
 * §9 self-check (incl. the SmartCredit summary parser + half-loaded guard).
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import {
  generateProgressReportV2Pdf,
  pv2BuildPdfData,
  pv2Contradictions,
  pv2CreditorSimilar,
  pv2Diff,
  pv2ItemKind,
  pv2LinkedLoan,
  pv2NormCreditor,
  pv2ParseSmartCreditSummary,
  pv2SelfCheck,
  pv2SummaryShortfall,
  pv2TargetRows,
  type Pv2RenderStats,
  type Pv2Target,
} from "./progressReportV2";

function tl(o: Partial<BureauTradeline>): BureauTradeline {
  return {
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: null,
    dateOpened: "01/2015", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
    creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
    lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [],
    ...o,
  };
}
const acct = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Partial<Record<Bureau, BureauTradeline>>): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, bureaus,
});
const on = (bs: Bureau[], f: (b: Bureau) => BureauTradeline) => Object.fromEntries(bs.map((b) => [b, f(b)])) as Partial<Record<Bureau, BureauTradeline>>;
const q = (date: string, creditor: string, bureau: Bureau): CreditInquiry => ({ date, creditor, bureau, matchedAccount: null });
const file = (reportDate: string, scores: Record<Bureau, number>, accounts: CreditAccount[], inquiries: CreditInquiry[]): CreditFile => ({
  provider: "smartcredit", reportDate, scores, accounts, inquiries, publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
});
const ALL: Bureau[] = ["TU", "EX", "EQ"];
const mortgage = (creditor: string, mask: string, lates: Bureau[], bureaus: Bureau[] = ALL) =>
  acct(creditor, mask, "mortgage", on(bureaus, (b) => tl({ dateOpened: "05/2019", accountType: "Conventional Real Estate Mortgage", highBalance: 384000, balance: 340000, late30: lates.includes(b) ? 2 : 0 })));
const card = (creditor: string, mask: string, limit: number, bal: number, o: Partial<BureauTradeline> = {}, bureaus: Bureau[] = ALL) =>
  acct(creditor, mask, "revolving", on(bureaus, () => tl({ dateOpened: "03/2012", accountType: "Credit Card", creditLimit: limit, balance: bal, ...o })));

describe("P1-5 / §7 creditor normalization + aliases", () => {
  it("alias map and suffix stripping", () => {
    expect(pv2NormCreditor("NATIONSTAR/MR COOPER")).toBe(pv2NormCreditor("NSTAR/COOPER"));
    expect(pv2NormCreditor("KCB CREDIT L")).toBe("kcbcredit");
    expect(pv2NormCreditor("KCBCREDIT")).toBe("kcbcredit");
    expect(pv2NormCreditor("COMENITYCAP")).toBe(pv2NormCreditor("COMENITY CAPITAL"));
    expect(pv2NormCreditor("CCB")).toBe(pv2NormCreditor("COMENITY CAPITAL"));
    expect(pv2NormCreditor("ACME FUNDING, LLC")).toBe("acmefunding");
    // A creditor whose name ends in L is not truncated.
    expect(pv2NormCreditor("CAPITAL")).toBe("capital");
  });
  it("fuzzy ≥ 0.9 and prefix variants are one company; different lenders are not", () => {
    expect(pv2CreditorSimilar("UNISOURCE CR", "UNISOURCE CREDIT LLC")).toBe(true);
    expect(pv2CreditorSimilar("PATHWARD NA/OPORTUN", "OPORTUN")).toBe(true);
    expect(pv2CreditorSimilar("MACYS/CBNA", "BEST BUY/CBNA")).toBe(false);
  });
});

describe("P0-2 one state per item per bureau", () => {
  it("servicing transfer: never REMOVED while the linked loan still carries the lates", () => {
    const before = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, [mortgage("NATIONSTAR/MR COOPER", "1111", ["TU", "EQ"])], []);
    const after = file("10/22/2026", { TU: 610, EX: 570, EQ: 610 }, [mortgage("FAY SERVICING LLC", "2222", ["TU", "EQ"])], []);
    expect(pv2LinkedLoan(before.accounts[0], after.accounts[0])).toBe(true);
    const d = pv2Diff(before, after);
    expect(d.wins).toEqual([]);
    expect(pv2Contradictions(d)).toEqual([]);
    expect(d.internal.join(" ")).toMatch(/Re-report \(not a win\): NATIONSTAR\/MR COOPER/);
  });

  it("both servicers on the same pull: labeled with last 4 + date opened so the client can tell them apart", () => {
    const before = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, [mortgage("NATIONSTAR/MR COOPER", "1111", ["TU", "EQ"])], []);
    const after = file("10/22/2026", { TU: 610, EX: 570, EQ: 610 }, [mortgage("NATIONSTAR/MR COOPER", "1111", ["TU", "EQ"]), mortgage("FAY SERVICING LLC", "2222", ["TU", "EQ"])], []);
    const d = pv2Diff(before, after);
    const items = d.targets.map((t) => t.item);
    expect(items).toContain("FAY SERVICING LLC (acct ending 2222, opened 05/2019) - Late payments");
    expect(items).toContain("NATIONSTAR/MR COOPER (acct ending 1111, opened 05/2019) - Late payments");
    expect(d.wins).toEqual([]);
    expect(items.join(" ")).not.toContain("...");
  });

  it("alias: NATIONSTAR/MR COOPER corrected on EX only — never 'removed' on TU/EQ while NSTAR/COOPER still reports lates there", () => {
    const before = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, [mortgage("NATIONSTAR/MR COOPER", "1111", ALL)], []);
    const after = file("10/22/2026", { TU: 610, EX: 570, EQ: 610 }, [mortgage("NSTAR/COOPER", "1111", ["TU", "EQ"])], []);
    const d = pv2Diff(before, after);
    const w = d.wins.find((x) => x.item.startsWith("NATIONSTAR"))!;
    expect(w.bureaus).toEqual(["EX"]);
    expect(w.status).toBe("PARTIAL");
    expect(d.targets.find((x) => x.item.startsWith("NSTAR/COOPER"))!.bureaus).toEqual(["TU", "EQ"]);
    expect(pv2Contradictions(d)).toEqual([]);
  });

  it("paid + closed but lates still reporting: one line says both; not a win", () => {
    const lowes = (after: boolean) =>
      card("SYNCB/LOWES", "3333", 2000, after ? 0 : 900, after ? { accountStatus: "Closed", paymentStatus: "Paid", late30: 5 } : { paymentStatus: "Late 30 Days", pastDue: 94, late30: 4 });
    const d = pv2Diff(file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, [lowes(false)], []), file("10/22/2026", { TU: 610, EX: 570, EQ: 610 }, [lowes(true)], []));
    expect(d.wins).toEqual([]);
    expect(d.clientActions).toHaveLength(1);
    expect(d.clientActions[0]).toMatch(/SYNCB\/LOWES went from late 30 days.*closed paid.*earlier late marks are still reporting on TU\/EX\/EQ/);
    expect(d.targets.map((t) => t.item)).toContain("SYNCB/LOWES - Late payments");
  });

  it("inquiry variants merge (KCB CREDIT / KCBCREDIT / KCB CREDIT L): same inquiry is not 'removed' and 'new' at once", () => {
    const acc = [card("CHASE", "4444", 5000, 100)];
    const before = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, acc, [q("09/25/2026", "KCB CREDIT L", "TU"), q("09/25/2026", "KCBCREDIT", "EQ")]);
    const after = file("10/22/2026", { TU: 610, EX: 570, EQ: 610 }, acc, [q("09/25/2026", "KCB CREDIT", "TU"), q("09/25/2026", "KCB CREDIT L", "EQ")]);
    const d = pv2Diff(before, after);
    expect(d.wins.filter((w) => w.kind === "inquiry")).toEqual([]);
    expect(d.newNegativeFacts.filter((f) => /KCB/.test(f))).toEqual([]);
  });
});

describe("P0-4 new negatives / P1-4 item type / P0-6 positives", () => {
  const before = file(
    "06/19/2026",
    { TU: 600, EX: 560, EQ: 600 },
    [card("OLD STORE CARD", "5555", 1000, 0, { dateOpened: "01/2000", late30: 2 }), card("CLEAN CARD", "6666", 3000, 0, { dateOpened: "06/2008" })],
    [],
  );
  const champion = acct("CHAMPION", "7777", "mortgage", on(["EX"], () => tl({ dateOpened: "02/2018", accountType: "Conventional Real Estate Mortgage", highBalance: 200000, balance: 150000, late30: 2, remarks: "ACCOUNT PURCHASED BY ANOTHER LENDER" })));
  const after = file(
    "10/22/2026",
    { TU: 627, EX: 591, EQ: 670 },
    [...before.accounts, champion],
    [q("09/20/2026", "MACYS/CBNA", "EQ"), q("09/25/2026", "KCB CREDIT", "TU"), q("09/25/2026", "KCB CREDIT", "EX"), q("09/25/2026", "KCB CREDIT", "EQ")],
  );
  const d = pv2Diff(before, after);

  it("new inquiries are NEW_NEGATIVE facts and Round 1 targets", () => {
    expect(d.newNegativeFacts).toEqual(expect.arrayContaining(["New hard inquiry: MACYS/CBNA 09/20/2026 (EQ).", "New hard inquiry: KCB CREDIT 09/25/2026 (TU/EX/EQ)."]));
    const kcb = d.targets.find((t) => t.item.startsWith("KCB CREDIT"))!;
    expect(kcb).toMatchObject({ round: 1, kind: "inquiry", isNew: true });
    expect(kcb.bureaus).toEqual(["TU", "EX", "EQ"]);
    expect(d.movementFacts.indexOf("New hard inquiry: MACYS/CBNA 09/20/2026 (EQ).")).toBeGreaterThanOrEqual(0);
  });
  it("CHAMPION with late counts is Late payments (a remark keyword never makes it a Collection)", () => {
    expect(pv2ItemKind(champion, [champion.bureaus.EX!])).toBe("late");
    expect(d.targets.find((t) => t.item.startsWith("CHAMPION"))!.item).toBe("CHAMPION - Late payments");
  });
  it("a negative account is never named in Positives (oldest clean account is)", () => {
    expect(d.positives.join(" ")).not.toContain("OLD STORE CARD");
    expect(d.positives.join(" ")).toContain("Credit history dating back to 2008 (CLEAN CARD)");
    // File Strength age still counts every account.
    expect(Math.floor(d.after.oldestYears!)).toBe(26);
  });
});

describe("P0-3 every target rendered", () => {
  const targets: Pv2Target[] = [
    ...Array.from({ length: 13 }, (_, i): Pv2Target => ({ item: `LENDER ${i + 1} - Late payments`, bureaus: ["TU"], detail: "TU 1x30", priority: "MEDIUM", lift: 6, round: 3, kind: "account" })),
    ...Array.from({ length: 7 }, (_, i): Pv2Target => ({ item: `INQ CO ${i + 1} - Hard inquiry 09/0${i + 1}/2026`, bureaus: ["EQ"], detail: "", priority: "LOW", lift: 5, round: 1, kind: "inquiry" })),
    { item: "AGENCY X - Collection", bureaus: ["TU", "EX"], detail: "$201 in collection", priority: "HIGH", lift: 15, round: 2, kind: "account" },
  ];
  it("fits: one row each", () => {
    const r = pv2TargetRows(targets, 30, "en");
    expect(r.rows).toHaveLength(21);
    expect(r.represented).toBe(21);
  });
  it("short on space: collapse by round, every name kept, no ellipses", () => {
    const r = pv2TargetRows(targets, 8, "en");
    expect(r.represented).toBe(21);
    expect(r.rows.length).toBeLessThanOrEqual(8);
    const text = r.rows.flat().join(" | ");
    for (const t of targets) expect(text).toContain(t.item.replace(/ - [^-]+$/, ""));
    expect(text).toMatch(/Round 1: 7 inquiries/);
    expect(text).not.toContain("...");
  });
});

describe("P0-5 projection, P1-1 roadmap = Step 1, P1-6 language, P2-3 pay-down, PDF", () => {
  const lates = Array.from({ length: 8 }, (_, i) => card(`LATE CARD ${i + 1}`, `90${i}`, 2000, 1500, { late30: 2 }));
  const before = file("06/19/2026", { TU: 607, EX: 564, EQ: 605 }, lates, [q("03/09/2026", "OLD INQ", "EX")]);
  const after = file("10/22/2026", { TU: 627, EX: 591, EQ: 670 }, lates, [q("09/20/2026", "NEW INQ", "EQ")]);
  const d = pv2Diff(before, after);
  const scores = { TU: { before: 607, after: 627 }, EX: { before: 564, after: 591 }, EQ: { before: 605, after: 670 } } as Record<Bureau, { before: number; after: number }>;
  const pdf = pv2BuildPdfData({ diff: d, clientFirstName: "Edith", clientName: "Edith V.", round: 4, scores, phone: "(949) 674-0714", site: "ofgllc.com" });

  it("goal per bureau ≤ current + 100 and ≤ 760; middle ceiling 727 from a 627 middle", () => {
    for (const b of ["TU", "EX", "EQ"] as Bureau[]) {
      const r = pdf.goalByBureau![b]!;
      expect(r[1]).toBeLessThanOrEqual(Math.min(760, scores[b].after + 100));
    }
    expect(pdf.goal.high).toBeLessThanOrEqual(727);
    expect(pdf.goal.high).toBeGreaterThan(627);
  });
  it("one round number (the report round); roadmap and Step 1 list the same negative accounts + the inquiry count (Cesar Oct 26)", () => {
    expect(pdf.programRound).toBe(4);
    const cards = Array.from({ length: 8 }, (_, i) => `LATE CARD ${i + 1}`);
    expect(pdf.activeSet).toEqual({ disputeRound: 4, items: cards });
    expect(pdf.plan[0]).toBe(`Our team (Round 4): we are actively disputing ${cards.join(", ")}, plus 1 hard inquiry.`);
  });
  it("facts only: no score-impact ranking, no timing language", () => {
    const text = [...pdf.actionNeeded, ...pdf.plan].join(" ");
    expect(text).not.toMatch(/largest score suppressor|30-60 days|next statement cycle/);
  });
  it("pay-down columns print the amount to pay (balance $1,500 on $2,000 → $900 to 30%, $1,300 to 10%)", () => {
    const u = pdf.utilization[0];
    expect([u.payDown30, u.payDown10]).toEqual([900, 1300]);
  });
  it("self-check passes on a consistent file; the PDF carries every target, 3 pages, CROA verbatim", async () => {
    const stats: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
    await generateProgressReportV2Pdf(pdf, null, stats);
    const sc = pv2SelfCheck({ before, after, summaries: { before: null, after: null }, diff: d, pdf, stats, recordTargets: d.targets.length });
    expect(sc.checks.filter((c) => c.pass === false)).toEqual([]);
    expect(stats).toMatchObject({ targetsRepresented: d.targets.length, pages: 3 });
    expect(stats.croaText).toContain("15 U.S.C. §1679 et seq.");
    expect(sc.checks.find((c) => c.key === "account_totals")!.pass).toBeNull(); // no summary printed → n/a, not a failure
  }, 30_000);
  it("self-check: a typed score that differs from the PDF holds the report; a record with fewer targets than the PDF fails and is named", async () => {
    const stats: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
    const bad = { ...pdf, scores: { ...pdf.scores, TU: { before: 607, after: 640 } } };
    await generateProgressReportV2Pdf(bad, null, stats);
    const sc = pv2SelfCheck({ before, after, summaries: { before: null, after: null }, diff: d, pdf: bad, stats, recordTargets: d.targets.length - 1 });
    expect(sc.pass).toBe(false);
    expect(sc.checks.filter((c) => c.pass === false).map((c) => c.key)).toEqual(["scores", "target_count"]);
    // Nov 2, 2026: a typed score that differs from the PDF holds the report (override with a reason).
    expect(sc.checks.find((c) => c.key === "scores")).toMatchObject({ pass: false, detail: "TU After: report 640, PDF 627" });
    // Out of range still fails.
    const stats2: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
    const out = { ...pdf, scores: { ...pdf.scores, EX: { before: 564, after: 905 } } };
    await generateProgressReportV2Pdf(out, null, stats2);
    expect(pv2SelfCheck({ before, after, summaries: { before: null, after: null }, diff: d, pdf: out, stats: stats2, recordTargets: d.targets.length }).checks.find((c) => c.key === "scores")!.pass).toBe(false);
  }, 30_000);
});

describe("§9 SmartCredit summary + half-loaded guard", () => {
  // Synthetic page-1 text in SmartCredit's layout (tab-separated bureau columns).
  const PAGE1 = [
    "Summary",
    "Total Accounts",
    "Open Accounts",
    "Closed Accounts",
    "Delinquent",
    "Derogatory",
    "Balances",
    "Payments",
    "Public Records",
    "Inquiries (2 Years)",
    "TOTAL USED \tAVAILABLE \tUTILIZATION",
    "TransUnion® \t$3,000 \t$12,000 \t25%",
    "Experian® \t$3,000 \t$12,000 \t25%",
    "Equifax® \t$2,500 \t$10,000 \t25%",
    "TransUnion® \tExperian® \tEquifax®",
    "620 \t590 \t660",
    "1980 \t1980 \t1980",
    "30 \t31 \t36",
    "8 \t6 \t7",
    "22 \t25 \t29",
    "1 \t2 \t1",
    "1 \t1 \t0",
    "$300,000 \t$4,000 \t$299,000",
    "$2,800 \t$200 \t$2,700",
    "0 \t0 \t0",
    "3 \t3 \t4",
  ].join("\n");
  const s = pv2ParseSmartCreditSummary(PAGE1)!;

  it("parses per-bureau totals (Total = Open + Closed) and the utilization table", () => {
    expect(s.perBureau.TU).toEqual({ totalAccounts: 30, openAccounts: 8, closedAccounts: 22, balances: 300000, publicRecords: 0, inquiries2y: 3 });
    expect(s.perBureau.EQ!.totalAccounts).toBe(36);
    expect(s.revolving.EQ).toEqual({ used: 2500, limit: 10000 });
    expect(pv2ParseSmartCreditSummary("no summary here")).toBeNull();
  });
  it("half-loaded print: fewer accounts read than the summary lists → shortfall named per bureau", () => {
    const thin = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, Array.from({ length: 11 }, (_, i) => card(`C${i}`, `${i}`, 1000, 0)), []);
    // Fewer accounts AND no balances (account pages never loaded).
    expect(pv2SummaryShortfall(thin, s)).toBe("TU 11 of 30, EX 11 of 31, EQ 11 of 36, TU balances $0 of $300,000, EX balances $0 of $4,000, EQ balances $0 of $299,000");
    const full = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, Array.from({ length: 36 }, (_, i) => card(`C${i}`, `${i}`, 20000, 9000)), []);
    expect(pv2SummaryShortfall(full, s)).toBeNull();
    // Names listed but details missing (the half-loaded SmartCredit sample): balances catch it even when counts look fine.
    const namesOnly = file("06/19/2026", { TU: 600, EX: 560, EQ: 600 }, Array.from({ length: 36 }, (_, i) => card(`C${i}`, `${i}`, 1000, 0)), []);
    expect(pv2SummaryShortfall(namesOnly, s)).toMatch(/^TU balances \$0 of \$300,000/);
  });
});

describe("P2-4 case hygiene (case alerts, never in the report)", () => {
  it("ID documents pending review on an active-round case", async () => {
    const { caseHygieneAlerts } = await import("./index");
    const now = new Date("2026-10-24T12:00:00Z");
    const a = caseHygieneAlerts({ clientStatus: "onboarding", caseStage: "round_5", proofOfAddressPendingSince: null, hasRoundSchedule: true, idDocsPendingSince: new Date("2026-10-20T12:00:00Z"), now });
    expect(a).toEqual([{ code: "status_behind_stage" }, { code: "id_docs_pending", days: 4 }]);
  }, 60_000);
});

describe("§9 every report format: printed date + own summary (synthetic text in each layout)", () => {
  it("MyFreeScoreNow: per-bureau open accounts / revolving / inquiries / collections, table-of-contents count, Report Date", async () => {
    const { pv2ParsePullSummary, pv2DetectReportFormat } = await import("./progressReportV2");
    const text = [
      "Three Bureau Credit Report",
      "1. Report Summary 1",
      "2. Revolving Accounts 3",
      "2.1 Acme Jewelers I 3",
      "2.2 Capital Card (CLOSED) 4",
      "4. Installment Accounts 15",
      "4.1 Auto Lender 15",
      "11. Collections 60",
      "Equifax Accounts Summary",
      "Experian Accounts Summary",
      "TransUnion Accounts Summary",
      "Equifax Experian TransUnion",
      "Report Date August 07, 2026 August 07, 2026 August 07, 2026",
      "Account Type Open With Balance Total Balance Available Credit Limit Debt-To-Credit Payment",
      "Revolving 2 1 $1,500 $500 $2,000 75% $50",
      "Total 3 2 $9,000 $500 $12,000 75% $300",
      "Account Type Open With Balance Total Balance Available Credit Limit Debt-To-Credit Payment",
      "Revolving 1 0 $0 $100 $100 0% $0",
      "Total 2 1 $7,500 $100 $10,100 74% $250",
      "Account Type Open With Balance Total Balance Available Credit Limit Debt-To-Credit Payment",
      "Revolving N/A N/A N/A N/A N/A N/A N/A",
      "Total 1 1 $7,500 $0 $10,000 75% $250",
      "Equifax Experian TransUnion",
      "Inquiries 0 7 2",
      "Public Records 0 0 0",
      "Collections 4 4 3",
    ].join("\n");
    expect(pv2DetectReportFormat(text)).toBe("mfsn");
    const s = pv2ParsePullSummary(text)!;
    expect(s).toMatchObject({ format: "mfsn", reportDate: "08/07/2026", accountsPrinted: 3 });
    expect(s.perBureau.EQ).toMatchObject({ openAccounts: 3, inquiries2y: 0, collections: 4, publicRecords: 0 });
    expect(s.perBureau.TU).toMatchObject({ openAccounts: 1, inquiries2y: 2, collections: 3 });
    expect(s.revolving.EQ).toEqual({ used: 1500, limit: 2000 });
    expect(s.revolving.TU).toBeNull();
  });

  it("myFICO: AS OF date (never the browser print header) + one account per Last Updated block", async () => {
    const { pv2ParsePullSummary } = await import("./progressReportV2");
    const text = ["FICO® SCORE 3B REPORT", "AS OF 8/25/2026", "9/15/26, 3:50 AM \tmyFICO 3-Bureau Report - 8/25/2026", "Lender A", "Last Updated \t– \t08/06/2026", "Lender B", "Last Updated \t07/31/2026 \t–"].join("\n");
    expect(pv2ParsePullSummary(text)).toMatchObject({ format: "myfico", reportDate: "08/25/2026", accountsPrinted: 2 });
  });

  it("lender tri-merge (Xactus-style Credit Summary): combined totals, collections / public records, Ordered date — not mistaken for myFICO", async () => {
    const { pv2ParsePullSummary } = await import("./progressReportV2");
    const text = [
      "Report ID: 1", "Repositories: TUC/EXP/EQX", "Client Code: X-1 Ordered: 09/23/2026", "FICO Score 4", "Credit Summary",
      "Totals 25 8 5 $6,688 $5 $84,569 $10,945 4 5 3 23",
      "Public Records:", "Collections/Charge-offs:", "Bankruptcy:", "0", "6", "No",
    ].join("\n");
    expect(pv2ParsePullSummary(text)).toMatchObject({ format: "trimerge", reportDate: "09/23/2026", merged: { totalAccounts: 25, openAccounts: 8, publicRecords: 0, collections: 6 } });
  });

  it("half-loaded / missing accounts on any layout: fewer accounts read than the report lists", async () => {
    const { pv2SummaryShortfall } = await import("./progressReportV2");
    const thin = file("08/07/2026", { TU: 600, EX: 600, EQ: 600 }, Array.from({ length: 5 }, (_, i) => card(`C${i}`, `${i}`, 1000, 0)), []);
    const base = { perBureau: { TU: null, EX: null, EQ: null }, revolving: { TU: null, EX: null, EQ: null } } as any;
    // Layout count compares the entries the reader returned before same-account copies were merged.
    expect(pv2SummaryShortfall({ ...thin, readEntries: 5 }, { ...base, format: "myfico", accountsPrinted: 11 })).toBe("5 of 11 accounts");
    // MyFreeScoreNow lists a collection once per bureau section: 24 entries → 18 accounts is complete.
    expect(pv2SummaryShortfall({ ...thin, readEntries: 24 }, { ...base, format: "mfsn", accountsPrinted: 24 })).toBeNull();
    // Reads stored before readEntries existed: the merged count is not comparable → skipped.
    expect(pv2SummaryShortfall(thin, { ...base, format: "mfsn", accountsPrinted: 24 })).toBeNull();
    expect(pv2SummaryShortfall(thin, { ...base, format: "trimerge", merged: { totalAccounts: 25, openAccounts: 8, publicRecords: 0, collections: 6 } })).toBe("5 of 25 accounts");
  });
});

describe("reader hint from the report's own counts", () => {
  it("per-bureau totals (SmartCredit / IdentityIQ) or the layout count (MyFreeScoreNow, myFICO, tri-merge)", async () => {
    const { pv2AccountHint } = await import("./progressReportV2");
    const none = { TU: null, EX: null, EQ: null } as any;
    expect(
      pv2AccountHint({ perBureau: { TU: { totalAccounts: 33 }, EX: { totalAccounts: 33 }, EQ: { totalAccounts: 39 } } as any, revolving: none }),
    ).toBe("This report's own summary lists 33 accounts on TransUnion, 33 accounts on Experian, 39 accounts on Equifax — return every one of them.");
    expect(pv2AccountHint({ format: "mfsn", perBureau: none, revolving: none, accountsPrinted: 24 })).toMatch(/lists 24 accounts .* return all 24, including every "Other Accounts" and collection entry/);
    expect(pv2AccountHint(null)).toBeNull();
  });
});
