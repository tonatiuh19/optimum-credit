/**
 * Acceptance test — "OFG Credit Analysis Engine Fix Spec" (Cesar, Oct 15 2026).
 * Fixture = the MFSN 3-bureau test file from the spec (creditors, balances,
 * dates, inquiries only — no name / SSN / address). Every expected value below
 * is the spec's acceptance table; keep this file as a permanent regression.
 */
import { describe, expect, it } from "vitest";
import type { BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import { buildCreditAnalysis } from "./creditAnalysisFromFile";

function tl(over: Partial<BureauTradeline>): BureauTradeline {
  return {
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null,
    dateReported: null, dateOpened: null, balance: null, closedDate: null, accountRating: null,
    description: null, disputeStatus: null, creditorType: null, accountStatus: "Open",
    paymentStatus: "Current", remarks: null, paymentAmount: null, lastPayment: null,
    termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [],
    ...over,
  };
}

const bofa = (): BureauTradeline =>
  tl({ dateOpened: "03/2024", balance: 304, creditLimit: 2900, accountType: "Credit Card" });

const ACCOUNTS: CreditAccount[] = [
  {
    creditor: "BANK OF AMERICA", mask: "4400****", section: "revolving", headerStatus: "Open",
    confident: true, bureaus: { TU: bofa(), EX: bofa(), EQ: bofa() },
  },
  {
    creditor: "WESTLAKE SERVICE INC", mask: "1001****", section: "installment", headerStatus: "Open",
    confident: true,
    bureaus: {
      EQ: tl({ dateOpened: "09/2023", balance: 6211, creditLimit: 15754, accountType: "Auto Loan" }),
      EX: tl({ dateOpened: "09/2023", balance: 0, creditLimit: 15754, accountType: "Auto Loan", accountStatus: "Closed", paymentStatus: "Paid" }),
      TU: tl({ dateOpened: "09/2023", balance: 5841, creditLimit: 15754, accountType: "Auto Loan" }),
    },
  },
  {
    creditor: "BCION", mask: "7700****", section: "installment", headerStatus: "Open",
    confident: true,
    bureaus: {
      EX: tl({ dateOpened: "12/2024", balance: 44664, creditLimit: 57271, accountType: "Auto Loan" }),
      TU: tl({ dateOpened: "12/2024", balance: 44664, creditLimit: 57271, accountType: "Auto Loan" }),
    },
  },
  {
    creditor: "TBOM/FORTIVA THD", mask: "5100****", section: "revolving", headerStatus: "Closed",
    confident: true,
    bureaus: {
      // Equifax: status Late 30 with a closed date, but its payment summary shows zero lates.
      EQ: tl({
        dateOpened: "03/2024", balance: 514, creditLimit: 500, pastDue: 60, accountType: "Credit Card",
        accountStatus: "Closed", paymentStatus: "Late 30 Days", closedDate: "09/2026",
        remarks: "Account closed by credit grantor",
      }),
      // Experian: the grid shows the 30-day mark; no closed date.
      EX: tl({
        dateOpened: "03/2024", balance: 514, creditLimit: 500, pastDue: 60, accountType: "Credit Card",
        accountStatus: "Closed", paymentStatus: "Late 30 Days", late30: 1, gridMarks: ["09/2026:30"],
        remarks: "Account closed by credit grantor",
      }),
    },
  },
];

const q = (date: string, creditor: string, bureau: CreditInquiry["bureau"]): CreditInquiry => ({
  date, creditor, bureau, matchedAccount: null,
});
const AUTO_LENDERS = ["EXETER FINANCE", "CPS", "GLOBAL LENDING", "CARMAX AUTO", "AMERICREDIT", "ALLY AUTO", "CHASE AUTO", "TD AUTO", "UNITED AUTO"];
const INQUIRIES: CreditInquiry[] = [
  // Dec 12-13, 2024 auto-shopping cluster: EQ 3 / EX 9 / TU 5 = 17.
  ...AUTO_LENDERS.slice(0, 3).map((c, i) => q(`12/1${2 + (i % 2)}/2024`, c, "EQ")),
  ...AUTO_LENDERS.map((c, i) => q(`12/1${2 + (i % 2)}/2024`, c, "EX")),
  ...AUTO_LENDERS.slice(0, 5).map((c, i) => q(`12/1${2 + (i % 2)}/2024`, c, "TU")),
  // Matches the BCION auto loan opened 12/2024 (permissible purpose).
  q("12/12/2024", "BCI FIN CORP", "TU"),
  // Active mortgage pull (escrow).
  q("10/13/2026", "CREDCO/EAST WEST BANK", "EQ"),
  q("10/13/2026", "CREDCO/EAST WEST BANK", "EX"),
  q("10/13/2026", "CREDCO/EAST WEST BANK", "TU"),
];

const FILE: CreditFile & { scoreModel: string } = {
  provider: "unknown",
  reportDate: "10/15/2026",
  scores: { TU: 752, EX: 644, EQ: 666 },
  scoreRatings: { TU: "Very Good", EX: "Fair", EQ: "Good" },
  identityFlags: [
    { bureau: "EQ", field: "ssn", detail: "SSN differs from Experian/TransUnion" },
    { bureau: "EQ", field: "name", detail: "Extra name variation" },
  ],
  accounts: ACCOUNTS,
  inquiries: INQUIRIES,
  publicRecordsReported: false,
  imagePages: 0,
  totalPages: 0,
  confidence: 1,
  warnings: [],
  scoreModel: "VantageScore 3.0",
};

describe("Credit Analysis acceptance (Fix Spec, Oct 15 2026)", () => {
  const a = buildCreditAnalysis(FILE, { escrow: true });

  it("scores keep each bureau's printed rating", () => {
    expect(a.scores).toEqual({ TU: 752, EX: 644, EQ: 666 });
    expect(a.scoreRatings).toEqual({ TU: "Very Good", EX: "Fair", EQ: "Good" });
  });

  it("accounts and positive/negative per bureau (EQ / EX / TU)", () => {
    expect([a.overview.EQ.totalAccounts, a.overview.EX.totalAccounts, a.overview.TU.totalAccounts]).toEqual([3, 4, 3]);
    expect([a.overview.EQ.positive, a.overview.EQ.negative]).toEqual([2, 1]);
    expect([a.overview.EX.positive, a.overview.EX.negative]).toEqual([3, 1]);
    expect([a.overview.TU.positive, a.overview.TU.negative]).toEqual([3, 0]);
  });

  it("hard inquiries 4 / 10 / 7", () => {
    expect([a.overview.EQ.hardInquiries, a.overview.EX.hardInquiries, a.overview.TU.hardInquiries]).toEqual([4, 10, 7]);
  });

  it("utilization: ~10% open cards; 24% incl. the closed over-limit card", () => {
    expect(a.utilizationOverall.all).toBe(10.5);
    expect(Math.round(a.utilizationOverall.inclClosed!)).toBe(24);
    const fortiva = a.utilization.find((u) => u.account.includes("FORTIVA"))!;
    expect(fortiva).toMatchObject({ closed: true, derogatory: true });
  });

  it("avg age 2y9m EQ, 2y6m EX/TU; oldest Sep 2023", () => {
    expect(a.overview.EQ.avgAgeMonths).toBe(33);
    expect(a.overview.EX.avgAgeMonths).toBe(30);
    expect(a.overview.TU.avgAgeMonths).toBe(30);
    expect(a.overview.EQ.oldest?.opened).toBe("09/2023");
  });

  it("negatives: 1 — Fortiva (EQ, EX), late 30, $60 past due, over limit", () => {
    expect(a.negatives).toHaveLength(1);
    const n = a.negatives[0];
    expect(n.creditor).toBe("TBOM/FORTIVA THD");
    expect(n.bureaus).toEqual(["EX", "EQ"]);
    expect(n.kind).toBe("late");
    expect(n.status).toMatch(/Late 30/);
    expect(n.status).toMatch(/\$60 past due/);
    // Spec v2.1 P1-4: over-limit is an accuracy flag, not status text.
    expect(n.accuracyFlags!.join(" ")).toMatch(/balance \$514 exceeds \$500 limit/);
    expect(n.accuracyFlags!.join(" ")).toMatch(/missing from TU/);
    // Spec v2.1 §5: late-payment account → Round 3; not reported to TransUnion.
    expect(n.round).toBe(3);
    expect(n.legalBasis).toBe("FCRA §611, §623");
    expect(n.inconsistencies.join(" | ")).toMatch(/Closed date: reported by EQ, not by EX/);
    expect(n.inconsistencies.join(" | ")).toMatch(/EQ: status "Late 30 Days" but payment history shows no lates/);
    expect(n.inconsistencies.join(" | ")).toMatch(/Not reported to TU/);
  });

  it("Round 1: same-DATE clusters (12/12, 12/13); BCI excluded (opened BCION); Credco excluded (active loan)", () => {
    // 17 auto-shopping pulls: 10 on 12/12, 7 on 12/13 (BCI is excluded, not clustered).
    expect(a.inquiryClusters.map((c) => [c.from, c.count, c.older12m])).toEqual([
      ["12/12/2024", 10, true],
      ["12/13/2024", 7, true],
    ]);
    const bci = a.inquiries.find((x) => x.creditor === "BCI FIN CORP")!;
    // Cesar (Oct 22): an inquiry matching an account opened within ~90 days is excluded.
    expect(bci).toMatchObject({ action: "permissible", excludedReason: "matches_account" });
    expect(bci.lowerOdds).toMatch(/BCION/);
    const credco = a.inquiries.filter((x) => x.creditor.startsWith("CREDCO"));
    expect(credco).toHaveLength(3);
    expect(credco.every((x) => x.excludedReason === "active_loan")).toBe(true);
  });

  it("Round 2: none on file", () => {
    expect(a.negatives.filter((n) => n.round === 2)).toEqual([]);
  });

  it("Spec v2.1 P0-7: identity variances go to Round 1; positive Westlake is never a dispute target", () => {
    expect(a.identityFlags.map((f) => `${f.bureau}:${f.field}`).sort()).toEqual(["EQ:name", "EQ:ssn"]);
    expect(a.accuracyUpdates).toEqual([]);
    expect(a.positives.some((p) => p.creditor === "WESTLAKE SERVICE INC")).toBe(true);
    expect(a.negatives.some((n) => n.creditor === "WESTLAKE SERVICE INC")).toBe(false);
  });

  it("escrow: active (agent), loan pulls excluded, tradelines after closing", () => {
    expect(a.escrow.active).toBe(true);
    expect(a.escrow.loanInquiries).toHaveLength(3);
    expect(a.tradelines.map((t) => t.code)).toEqual(["IH-1", "IH-2", "primary"]);
    // Spec §7: AU lines after closing; primary line held until after closing.
    expect(a.tradelines.filter((t) => t.code !== "primary").every((t) => t.timing === "after_closing")).toBe(true);
    expect(a.tradelines.find((t) => t.code === "primary")).toMatchObject({ timing: "hold", note: "Hold until after closing" });
    expect(a.tradelines.find((t) => t.code === "IH-2")?.optional).toBe(true);
  });

  it("escrow is also auto-detected from the recent mortgage pull", () => {
    expect(buildCreditAnalysis(FILE).escrow).toMatchObject({ active: true, source: "mortgage_pull" });
    expect(buildCreditAnalysis(FILE, { escrow: false }).escrow.active).toBe(false);
  });

  it("file strength: current 46 (8, 18, 0, 8, 12); conservative projection (no loan credit before closing)", () => {
    expect(a.fileStrength.factors.map((f) => f.current)).toEqual([8, 18, 0, 8, 12]);
    expect(a.fileStrength.current).toBe(46);
    expect(a.fileStrength.postRepair).toBeGreaterThan(46);
    expect(a.fileStrength.factors.find((f) => f.key === "mortgage")!.postRepair).toBe(0);
  });

  it("program: Standard (no counted Complex trigger)", () => {
    expect(a.programTier).toBe("standard");
  });

  it("projections move per bureau: only EQ/EX (where Fortiva reports) move in Round 3", () => {
    const by = Object.fromEntries(a.projections.map((p) => [p.key, p.scores]));
    // Spec §6: a step only for rounds that have items (no Round 4 here); v2.3 P1-7: never a utilization/AU row.
    expect(Object.keys(by)).toEqual(["current", "round1", "round3"]);
    expect(by.round3.EQ!).toBeGreaterThan(by.round1.EQ!);
    expect(by.round3.EX!).toBeGreaterThan(by.round1.EX!);
    expect(by.round3.TU).toBe(by.round1.TU);
    for (const b of ["TU", "EX", "EQ"] as const) {
      expect(by.round3[b]!).toBeGreaterThanOrEqual(by.current[b]!);
      expect(by.round3[b]!).toBeLessThanOrEqual(Math.min(760, by.current[b]! + 100));
    }
  });
});

describe("Credit Analysis PDF (acceptance file)", () => {
  it("renders the Spec §8 5-page layout: active-loan banner, exclusions, IH codes, CROA", async () => {
    const { generateOfgCreditAnalysisPdf } = await import("./ofgCreditAnalysisPdf");
    const data = buildCreditAnalysis(FILE, { escrow: true, lender: { model: "FICO", score: 630, target: 660 } });
    const buf = await generateOfgCreditAnalysisPdf(data, {
      clientName: "Acceptance Client",
      lang: "en",
      program: {
        standardPrice: "$1,497",
        complexPrice: "$2,497",
        standardUrl: "optimum-financial-group.com/premium-plan-payment",
        complexUrl: "optimum-financial-group.com/complex-repair-payment",
        phone: "(949) 736-5644",
        site: "optimum-financial-group.com",
      },
    });
    if (process.env.ACCEPTANCE_PDF_OUT) (await import("fs")).writeFileSync(process.env.ACCEPTANCE_PDF_OUT, buf);
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    const text = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
    for (const must of [
      "ACTIVE LOAN FILE",
      "Coordinate dispute timing with the loan officer",
      "needs 660",
      "10 same-day inquiries (12/12/2024)",
      "EXCLUDED - permissible purpose (matches BCION",
      "EXCLUDED - permissible purpose (active transaction)",
      "Personal info",
      "IH-1 ($800)",
      "After closing or before next application",
      "Hold: until after closing",
      "46 / 100",
      "Standard Repair - $1,497",
      "This analysis is based on information provided and does not constitute legal advice.",
    ]) {
      expect(text, must).toContain(must);
    }
    // Never SSN digits or cardholder names.
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });
});
