/**
 * Acceptance test — "Progress Report Generator v2" spec (Cesar, Oct 15 2026),
 * Section 9. BEFORE 02/17/2026 → AFTER 09/22/2026. Fixture = accounts,
 * balances, dates and inquiries from the spec only (no name / SSN / address).
 * Keep as a permanent regression.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import {
  generateProgressReportV2Pdf,
  pv2AsciiBar,
  pv2BuildPdfData,
  pv2Diff,
  pv2FileStrength,
  pv2MiddleScore,
  pv2Validate,
} from "./progressReportV2";

function tl(over: Partial<BureauTradeline>): BureauTradeline {
  return {
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null,
    dateReported: null, dateOpened: null, balance: 0, closedDate: null, accountRating: null,
    description: null, disputeStatus: null, creditorType: null, accountStatus: "Open",
    paymentStatus: "Current", remarks: null, paymentAmount: null, lastPayment: null,
    termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [],
    ...over,
  };
}
const all3 = (t: BureauTradeline): Partial<Record<Bureau, BureauTradeline>> => ({ TU: { ...t }, EX: { ...t }, EQ: { ...t } });
const acct = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Partial<Record<Bureau, BureauTradeline>>): CreditAccount => ({
  creditor, mask, section, headerStatus: null, bureaus, confident: true,
});
const card = (limit: number, balance: number, opened: string, extra: Partial<BureauTradeline> = {}) =>
  tl({ creditLimit: limit, balance, dateOpened: opened, accountType: "Credit Card", ...extra });

// Accounts shared by both pulls (balances differ).
const toyota = (bal: number) =>
  acct("TOYOTA MOTOR CREDIT", "6001****", "installment", {
    TU: tl({ dateOpened: "05/2019", balance: bal, accountStatus: "Closed", paymentStatus: "Charge-off", remarks: "Charged off as bad debt" }),
    EX: tl({ dateOpened: "05/2019", balance: bal, accountStatus: "Closed", paymentStatus: "Charge-off", late30: 4, late60: 3, late90: 5 }),
    EQ: tl({ dateOpened: "05/2019", balance: bal, accountStatus: "Closed", paymentStatus: "Charge-off", late30: 4, late60: 3, late90: 22 }),
  });
const freedom = (before: boolean) =>
  acct("FREEDOM MORTGAGE", "7100****", "mortgage", {
    TU: tl({ dateOpened: "03/2021", balance: 300000, paymentStatus: before ? "Late 30 Days" : "Current", pastDue: before ? 5263 : 0, late30: before ? 13 : 14, late60: 1 }),
    EX: tl({ dateOpened: "03/2021", balance: 300000, paymentStatus: before ? "Late 30 Days" : "Current", pastDue: before ? 5263 : 0, late30: 13, late60: 1 }),
    EQ: tl({ dateOpened: "03/2021", balance: 300000, paymentStatus: before ? "Late 30 Days" : "Current", pastDue: before ? 5263 : 0, late30: 14, late60: 1 }),
  });
const porsche = (before: boolean) =>
  acct("PORSCHE FINANCIAL", "8800****", "installment", {
    TU: tl({ dateOpened: "01/2022", balance: before ? 20000 : 0, accountStatus: before ? "Open" : "Closed", paymentStatus: before ? "Late 30 Days" : "Paid", pastDue: before ? 2928 : 0, late30: before ? 0 : 1 }),
    EX: tl({ dateOpened: "01/2022", balance: before ? 20000 : 0, accountStatus: before ? "Open" : "Closed", paymentStatus: before ? "Late 30 Days" : "Paid", pastDue: before ? 2928 : 0, late30: 1 }),
  });

const OTHER_CARDS = (b: boolean) => [
  acct("NORDSTROM/TD", "4000****", "revolving", all3(card(7800, b ? 7725 : 5042, "06/2010"))),
  acct("NEIMAN MARCUS/CAP ONE", "5178****", "revolving", all3(card(b ? 5000 : 8000, b ? 2581 : 3859, "02/2012"))),
  acct("TJX REWARDS", "6040****", "revolving", all3(card(3900, b ? 1727 : 1259, "08/2014"))),
  acct("JPMCB CARD", "4147****", "revolving", all3(card(2100, b ? 2139 : 1150, "09/2016"))),
  acct("TJX MASTERCARD", "5440****", "revolving", all3(card(1290, b ? 1197 : 593, "03/2018"))),
  acct("AMEX", "3499****", "revolving", all3(card(1000, b ? 0 : 95, "07/2019"))),
  acct("BEN BRIDGE", "6011****", "revolving", { TU: card(15000, 0, "11/2015"), EQ: card(15000, 0, "11/2015") }),
  acct("CAPITAL ONE", "5178991****", "revolving", all3(card(5000, 0, "03/2013"))),
  acct("CHASE", "4266****", "revolving", all3(card(800, 0, "05/2017"))),
  acct("DEPT STORE", "6019****", "revolving", all3(card(500, 0, "01/2018"))),
  acct("COUNTY OF LOS ANGELES", "1200****", "installment", all3(tl({ dateOpened: "04/2006", balance: 0, accountStatus: "Closed", paymentStatus: "Paid" }))),
  acct("MERCEDES-BENZ FIN", "9100****", "installment", all3(tl({ dateOpened: "02/2015", balance: 0, accountStatus: "Closed", paymentStatus: "Paid" }))),
];

const BEFORE_ACCOUNTS: CreditAccount[] = [
  acct("BEST BUY/CBNA", "702127****", "revolving", all3(card(35000, 33050, "10/2008"))),
  acct("THD/CBNA", "6035****", "revolving", all3(card(4000, 1200, "05/2017", { accountStatus: "Closed", paymentStatus: "Late 30 Days", late30: 1 }))),
  acct("CB/RH", "5856****", "revolving", all3(card(3000, 0, "12/2020", { accountStatus: "Closed", late30: 1 }))),
  acct("COMENITY/VICTORIA'S SECRET", "5856370****", "revolving", { EQ: card(1500, 400, "09/2019", { late30: 1 }) }),
  toyota(6072),
  freedom(true),
  porsche(true),
  ...OTHER_CARDS(true),
];
const AFTER_ACCOUNTS: CreditAccount[] = [
  // Renamed, same account (not a removal).
  acct("CBNA", "702127****", "revolving", all3(card(35000, 30748, "10/2008"))),
  // CB/RH: late removed on EX/EQ, still on TU.
  acct("CB/RH", "5856****", "revolving", {
    TU: card(3000, 0, "12/2020", { accountStatus: "Closed", late30: 1 }),
    EX: card(3000, 0, "12/2020", { accountStatus: "Closed" }),
    EQ: card(3000, 0, "12/2020", { accountStatus: "Closed" }),
  }),
  // Comenity/Victoria's Secret re-reported on EQ under a new name/number.
  acct("CB/VICSCRT", "4447960****", "revolving", { EQ: card(1500, 380, "09/2019", { late30: 1 }) }),
  toyota(6072),
  freedom(false),
  porsche(false),
  ...OTHER_CARDS(false),
];

const q = (date: string, creditor: string, bureau: Bureau): CreditInquiry => ({ date, creditor, bureau, matchedAccount: null });
const BEFORE_INQ: CreditInquiry[] = [
  q("02/02/2026", "MB FIN SVCS", "TU"),
  q("02/03/2026", "HOUSE OF IMP", "TU"),
  q("02/03/2026", "CALSTAR MOTO", "TU"),
  q("02/04/2026", "PORSCHE OF D", "TU"),
  q("02/04/2026", "PORSCHEOFD", "EQ"),
  // 2024 inquiries: over 24 months before the AFTER pull — age off, not wins.
  q("08/15/2024", "CISCO", "TU"),
  q("08/20/2024", "NEIMN", "EX"),
];
const AFTER_INQ: CreditInquiry[] = [q("06/01/2026", "US BANK", "TU"), q("06/01/2026", "TESLA", "EX")];

const file = (reportDate: string, scores: Record<Bureau, number>, accounts: CreditAccount[], inquiries: CreditInquiry[]): CreditFile => ({
  provider: "smartcredit", reportDate, scores, accounts, inquiries, publicRecordsReported: false,
  imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
});
const BEFORE = file("02/17/2026", { TU: 570, EX: 567, EQ: 570 }, BEFORE_ACCOUNTS, BEFORE_INQ);
const AFTER = file("09/22/2026", { TU: 607, EX: 606, EQ: 608 }, AFTER_ACCOUNTS, AFTER_INQ);

describe("Progress Report v2 acceptance (Kathy file, spec Section 9)", () => {
  const d = pv2Diff(BEFORE, AFTER);

  it("scores and middle score", () => {
    expect(pv2MiddleScore(BEFORE.scores)).toBe(570);
    expect(pv2MiddleScore(AFTER.scores)).toBe(607);
    expect(pv2AsciiBar(607)).toBe("[===========         ]");
  });

  it("wins: THD/CBNA removed TU/EX/EQ; CB/RH partial (TU remains); 5 inquiries", () => {
    const thd = d.wins.find((w) => w.item.startsWith("THD/CBNA"))!;
    expect(thd).toMatchObject({ status: "REMOVED", bureaus: ["TU", "EX", "EQ"] });
    const rh = d.wins.find((w) => w.item.startsWith("CB/RH"))!;
    expect(rh).toMatchObject({ status: "PARTIAL", bureaus: ["EX", "EQ"], remainsOn: ["TU"] });
    const inq = d.wins.find((w) => w.kind === "inquiry")!;
    expect(inq.item).toMatch(/TU x4 \/ EQ x1/);
    for (const n of ["MB FIN SVCS", "HOUSE OF IMP", "CALSTAR MOTO", "PORSCHE OF D", "PORSCHEOFD"]) expect(inq.item).toContain(n);
  });

  it("NOT wins: Comenity re-report, 2024 inquiries aged off, Best Buy -> CBNA rename", () => {
    const items = d.wins.map((w) => w.item);
    expect(items.some((i) => /COMENITY|VICTORIA|VICSCRT|BEST BUY/.test(i) || i.startsWith("CBNA"))).toBe(false);
    expect(items.join(" | ")).not.toMatch(/CISCO|NEIMN/);
    expect(d.internal.join(" | ")).toMatch(/Re-report \(not a win\): COMENITY\/VICTORIA'S SECRET on EQ re-reported as CB\/VICSCRT/);
    expect(d.internal.join(" | ")).toMatch(/Aged off \(not a win\): CISCO TU, NEIMN EX/);
  });

  it("client action: Freedom past due -> $0 Current; Porsche closed paid", () => {
    const text = d.clientActions.join(" | ");
    expect(text).toMatch(/FREEDOM MORTGAGE went from late 30 days \(\$5,263 past due\) to Current with \$0 past due/);
    expect(text).toMatch(/PORSCHE FINANCIAL went from late 30 days \(\$2,928 past due\) to closed paid/);
  });

  it("targets: Toyota charge-off $6,072; Freedom lates; Porsche 30-day TU/EX; CB/RH TU", () => {
    const by = (s: string) => d.targets.find((t) => t.item.startsWith(s))!;
    expect(by("TOYOTA MOTOR CREDIT")).toMatchObject({ bureaus: ["TU", "EX", "EQ"], priority: "HIGH" });
    expect(by("TOYOTA MOTOR CREDIT").detail).toMatch(/\$6,072 charged off/);
    expect(by("TOYOTA MOTOR CREDIT").detail).toMatch(/EX 4x30, 3x60, 5x90; EQ 4x30, 3x60, 22x90/);
    expect(by("FREEDOM MORTGAGE").bureaus).toEqual(["TU", "EX", "EQ"]);
    expect(by("PORSCHE FINANCIAL").bureaus).toEqual(["TU", "EX"]);
    expect(by("CB/RH").bureaus).toEqual(["TU"]);
  });

  it("utilization: TU 61% -> 53%; CBNA 88% top; pay to 30% = $10,500", () => {
    expect(d.utilizationOverall).toMatchObject({ bureau: "TU", after: 53 });
    // Spec: 61% at baseline (limits changed since; +/- 2 for the limit set).
    expect(Math.abs(d.utilizationOverall.before! - 61)).toBeLessThanOrEqual(2);
    expect(d.utilization[0]).toMatchObject({ account: "CBNA", pct: 88, current: 30748, limit: 35000, payTo30: 10500, baseline: 33050 });
    expect(d.utilization.every((u) => u.payTo10 <= u.payTo30)).toBe(true);
    expect(d.utilizationNotes.join(" ")).toMatch(/NEIMAN MARCUS\/CAP ONE limit increased from \$5,000 to \$8,000/);
    expect(d.utilizationNotes.join(" ")).toMatch(/\$15,000 BEN BRIDGE line is not currently reporting on EX/);
  });

  it("internal flags: new inquiries US Bank + Tesla; TU late count +1 on Freedom and Porsche", () => {
    const text = d.internal.join(" | ");
    expect(text).toMatch(/New inquiries: US BANK TU 06\/01\/2026, TESLA EX 06\/01\/2026/);
    expect(text).toMatch(/TU late count \+1 on FREEDOM MORTGAGE/);
    expect(text).toMatch(/TU late count \+1 on PORSCHE FINANCIAL/);
  });

  it("file strength 62 (+/- 5) and caps", () => {
    const pdf = pv2BuildPdfData({
      diff: d,
      clientFirstName: "Client",
      clientName: "Acceptance Client",
      round: 3,
      scores: { TU: { before: 570, after: 607 }, EX: { before: 567, after: 606 }, EQ: { before: 570, after: 608 } },
      phone: "(949) 736-5644",
      site: "optimum-financial-group.com",
    });
    expect(Math.abs(pdf.fileStrength - 62)).toBeLessThanOrEqual(5);
    // Alina-type file: 82-87% utilization can never be 100.
    expect(pv2FileStrength({ openChargeOffsOrCollections: 0, lates24m: false, olderLates: false, overallUtil: 85, publicRecord: false, openRevolving: 5, anyDerogatory: false })).toBeLessThanOrEqual(70);
    // Projected goal is a range above current.
    expect(pdf.goal.low).toBeGreaterThan(607);
    expect(pdf.goal.high).toBeGreaterThan(pdf.goal.low);
  });

  it("validation: parse failure when either pull has 0 accounts; clean diff has only internal notes", () => {
    const bad = pv2Diff(file("02/17/2026", BEFORE.scores, [], []), AFTER);
    const flags = pv2Validate({
      diff: bad,
      scoresBefore: BEFORE.scores,
      scoresAfter: AFTER.scores,
      clientText: [],
      fileStrength: 60,
      goal: { low: 650, high: 680 },
      utilization: [],
    });
    expect(flags.map((f) => f.code)).toContain("parse_failure");
    const ok = pv2Validate({
      diff: d,
      scoresBefore: BEFORE.scores,
      scoresAfter: AFTER.scores,
      clientText: ["Toyota charge-off remains"],
      fileStrength: 60,
      goal: { low: 650, high: 680 },
      utilization: d.utilization,
    });
    expect(ok.filter((f) => f.code !== "internal_note")).toEqual([]);
  });

  it("renders exactly 3 pages with the spec sections and CROA", async () => {
    const data = pv2BuildPdfData({
      diff: d,
      clientFirstName: "Client",
      clientName: "Acceptance Client",
      round: 3,
      scores: { TU: { before: 570, after: 607 }, EX: { before: 567, after: 606 }, EQ: { before: 570, after: 608 } },
      phone: "(949) 736-5644",
      site: "optimum-financial-group.com",
    });
    const buf = await generateProgressReportV2Pdf(data);
    if (process.env.ACCEPTANCE_PDF_OUT) (await import("fs")).writeFileSync(process.env.ACCEPTANCE_PDF_OUT, buf);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(3);
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    const text = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
    for (const must of [
      "Your Score Progress",
      "570 -> 607 (+37 pts)",
      "What Came Off Your Report",
      "PARTIAL WIN (TU remains)",
      "Your progress too",
      "Round 3 Targets",
      "Credit Utilization",
      "Pay to $10,500",
      "Total revolving (TU) $80,390 $48,419 $42,746 53%",
      "Every bureau moved up, and your middle score climbed from 570 to 607",
      "What Is Working in Your Favor",
      "Your Roadmap",
      "FILE STRENGTH",
      "Credit Repair Organizations Act (CROA)",
    ]) {
      expect(text, must).toContain(must);
    }
    // Compliance: no statute citations other than CROA, never "FICO" on Vantage.
    expect(text).not.toMatch(/FCRA|FDCPA|§611|FICO/);
  });
});
