/**
 * Regression — mortgage tri-merge report (Cesar, Oct 19 2026): charge cards,
 * government original creditor, paid $0 card closed by the bank, escrow from
 * the report's own FICO 2/4/5 models, Standard tier, consistent totals.
 * Synthetic data in the same shape as the real file (no client PII).
 */
import { describe, expect, it } from "vitest";
import type { BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import { buildCreditAnalysis } from "./creditAnalysisFromFile";
import { actionPlan, generateOfgCreditAnalysisPdf } from "./ofgCreditAnalysisPdf";
import { creditAnalysisLabelSlugs } from "./index";

function tl(over: Partial<BureauTradeline>): BureauTradeline {
  return {
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null,
    dateReported: null, dateOpened: "01/2018", balance: null, closedDate: null, accountRating: null,
    description: null, disputeStatus: null, creditorType: null, accountStatus: "Open",
    paymentStatus: "AS AGREED", remarks: null, paymentAmount: null, lastPayment: null,
    termLength: null, pastDue: 0, accountType: "REV", paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [],
    ...over,
  };
}

const all3 = (t: () => BureauTradeline) => ({ TU: t(), EX: t(), EQ: t() });
const acct = (creditor: string, section: CreditAccount["section"], bureaus: CreditAccount["bureaus"]): CreditAccount => ({
  creditor, mask: null, section, headerStatus: null, confident: true, bureaus,
});

const ACCOUNTS: CreditAccount[] = [
  // Charge cards (Metro 2 "OPEN" type): the "limit" is a high balance.
  acct("AMEX", "revolving", all3(() => tl({ creditLimit: 119256, balance: 50225, accountType: "OPEN" }))),
  acct("AMEX", "revolving", all3(() => tl({ creditLimit: 88050, balance: 29737, accountType: "OPEN" }))),
  acct("CAPITAL ONE", "revolving", all3(() => tl({ creditLimit: 40000, balance: 39442 }))),
  acct("JPMCB CARD", "revolving", all3(() => tl({ creditLimit: 38700, balance: 37496 }))),
  // Inactive (not closed) $0 card: counts in the limit everywhere.
  acct("SYNCB/LIVSPC", "revolving", all3(() => tl({ creditLimit: 2000, balance: 0, accountStatus: "Other", paymentStatus: "INACTIVE" }))),
  // Paid $0 card closed by the bank, no lates — NOT negative.
  acct("CBNA", "revolving", {
    EQ: tl({ creditLimit: 500, balance: 0, accountStatus: "Paid", paymentStatus: "PAID", remarks: "ACCOUNT CLOSED BY CREDIT GRANTOR" }),
    EX: tl({ creditLimit: 500, balance: 0, accountStatus: "Paid", paymentStatus: "PAID", remarks: "ACCOUNT CLOSED BY CREDIT GRANTOR" }),
  }),
  acct("UNIVERSAL BANK", "mortgage", all3(() => tl({ creditLimit: 475000, balance: 408497, accountType: "MTG" }))),
  // Government original creditor reporting its own debt.
  acct("SBA", "collection", {
    TU: tl({
      creditLimit: 620500, balance: 620505, pastDue: 167508, accountType: "INST", late90: 1,
      accountStatus: "Derogatory", paymentStatus: "COLLECTION", remarks: "PLACED FOR COLLECTION; GOVERNMENT",
      gridMarks: ["02/2026:CO"],
    }),
  }),
];

const FILE: CreditFile & { scoreModel: string } = {
  provider: "unknown",
  reportDate: "09/17/2026",
  scores: { TU: 606, EX: 670, EQ: 685 },
  scoreRatings: { TU: null, EX: null, EQ: null },
  identityFlags: [],
  accounts: ACCOUNTS,
  inquiries: [
    { creditor: "ADVANTAGE CREDIT, INC.", bureau: "EX", date: "07/28/2026" },
    { creditor: "ADVNTGE CRED", bureau: "TU", date: "07/28/2026" },
    { creditor: "ADVANTAGE CREDIT/FCF", bureau: "EQ", date: "05/22/2026" },
  ],
  publicRecordsReported: false,
  imagePages: 0,
  totalPages: 0,
  confidence: 1,
  warnings: [],
  scoreModel:
    "FICO Classic (multiple: Equifax FICO Classic V5 FACTA, TransUnion FICO Classic 04, Experian FAIR ISAAC VER. 2)",
} as CreditFile & { scoreModel: string };

describe("Credit Analysis — mortgage tri-merge regression", () => {
  const a = buildCreditAnalysis(FILE);

  it("excludes charge cards from utilization; rows and overview agree", () => {
    expect(a.utilization.some((u) => u.account === "AMEX")).toBe(false);
    const openLimit = a.utilization.filter((u) => !u.closed).reduce((s, u) => s + u.limit, 0);
    expect(openLimit).toBe(80700);
    for (const b of ["TU", "EX", "EQ"] as const) expect(a.overview[b].revolvingLimit).toBe(80700);
    expect(a.utilizationOverall.all).toBe(95.3);
  });

  it("government original creditor → Round 3 accuracy (FCRA §611/§623), not FDCPA §809", () => {
    const sba = a.negatives.find((n) => n.creditor === "SBA")!;
    expect(sba.round).toBe(3);
    expect(sba.legalBasis).not.toMatch(/FDCPA/);
  });

  it("paid $0 card closed by credit grantor with no lates is not negative", () => {
    expect(a.negatives.map((n) => n.creditor)).toEqual(["SBA"]);
  });

  it("mortgage FICO 2/4/5 report → escrow, loan pulls excluded, tradelines after closing", () => {
    expect(a.escrow).toMatchObject({ active: true, source: "mortgage_report" });
    expect(a.inquiries.every((q) => q.excludedReason === "active_loan")).toBe(true);
    expect(a.tradelines.length).toBeGreaterThan(0);
    expect(a.tradelines.filter((t) => t.code !== "primary").every((t) => t.timing === "after_closing")).toBe(true);
    expect(a.tradelines.find((t) => t.code === "primary")?.timing).toBe("hold");
  });

  it("action plan never says 'add a primary line' and 'avoid new credit' unconditionally", () => {
    const plan = actionPlan(a as never, false).join(" ");
    expect(plan).toMatch(/Confirm dispute timing with the loan officer/);
    expect(plan).toMatch(/AU tradeline \(IH-1\): add after closing/);
    // Spec v2.3 P0-7: no pay / pay-down step.
    expect(plan).not.toMatch(/\b(pay (it )?down|pay off|bring .* to \$|or less)\b/i);
    expect(plan).not.toMatch(/avoid new credit applications during the program\./);
  });

  it("SBA alone does not make the program Complex", () => {
    expect(a.programTier).toBe("standard");
  });

  it("agent escrow=false still wins over the mortgage-report signal", () => {
    expect(buildCreditAnalysis(FILE, { escrow: false }).escrow.active).toBe(false);
  });

  it("PDF renders with the long score-model header", async () => {
    const bytes = await generateOfgCreditAnalysisPdf(a as never, {
      clientName: "Test Client",
      language: "en",
      program: { phone: "000", site: "example.com" },
    } as never);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("item labels come from the new engine's negatives", () => {
    // SBA government debt in the collections section → collections only;
    // no inquiries are disputable in escrow.
    expect(creditAnalysisLabelSlugs(a, FILE)).toEqual(["collections"]);
  });
});
