/**
 * Lead credit insights — rules over combinations of the conditions that drive
 * them (synthetic files only): middle score vs cutoffs, lender target, active
 * mortgage file, partner referral, shopping inquiries, new account, negatives
 * by type, paid collections / duplicates (quick wins), no open card, program
 * tier; plus stage alerts between two reads and the extra reads (score
 * factors, thin file, student / medical, addresses, lender simulation).
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import { buildCreditAnalysis } from "./creditAnalysisFromFile";
import {
  LEAD_SCORE_TARGETS,
  buildLeadCreditInsights,
  leadHeatScore,
  leadInsightAlertText,
  leadInsightAlerts,
  leadNextAction,
  leadReadiness,
  leadTargetScore,
  type LeadCreditInsights,
} from "./leadCreditInsights";

const B: Bureau[] = ["TU", "EX", "EQ"];
const REPORT = "10/26/2026";
const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: "10/01/2026",
  dateOpened: "01/2015", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
  creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
  lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...o,
});
const acct = (creditor: string, mask: string, section: CreditAccount["section"], o: Partial<BureauTradeline>, extra: Partial<CreditAccount> = {}): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, bureaus: Object.fromEntries(B.map((b) => [b, tl(o)])), ...extra,
});

type Combo = {
  middle: number;
  activeLoan: boolean;
  partner: boolean;
  inquiries: 0 | 1 | 4;
  newAccount: boolean;
  negatives: "none" | "paid_collection" | "charge_off";
  openCard: boolean;
};

function build(c: Combo) {
  const accounts: CreditAccount[] = [
    acct("AUTO LENDER", "1000", "installment", { accountType: "Auto Loan", balance: 9000, creditLimit: 15000, dateOpened: c.newAccount ? "09/21/2026" : "03/2019" }),
    acct("OLD BANK", "2000", "revolving", { creditLimit: 2000, closedDate: c.openCard ? null : "01/2024", accountStatus: c.openCard ? "Open" : "Closed", balance: c.openCard ? 300 : 0 }),
    acct("MORTGAGE CO", "3000", "installment", { accountType: "Installment", balance: 0, creditLimit: 5000, closedDate: "01/2022", accountStatus: "Paid" }),
    acct("STORE CARD", "4000", "revolving", { creditLimit: 1000, balance: 100 }),
    acct("BANK TWO", "5000", "revolving", { creditLimit: 3000, balance: 0 }),
  ];
  if (c.negatives === "paid_collection")
    accounts.push(acct("COLLECTOR", "6000", "collection", { balance: 0, creditLimit: 400, closedDate: "09/2026", paymentStatus: "Collection", accountStatus: "Collection", dateLastActivity: "03/2024", dateOpened: "02/2024" }));
  if (c.negatives === "charge_off")
    accounts.push(acct("BIG BANK", "7000", "revolving", { balance: 5200, creditLimit: 5000, closedDate: "05/2025", paymentStatus: "Charge Off", accountStatus: "Charge Off", pastDue: 5200 }));
  const inquiries: CreditInquiry[] = Array.from({ length: c.inquiries }, (_, i) => ({ creditor: `LENDER ${i}`, bureau: B[i % 3], date: "09/18/2026", matchedAccount: null }));
  const scores = { TU: c.middle - 10, EX: c.middle, EQ: c.middle + 10 };
  const file: CreditFile = {
    provider: "unknown" as never, reportDate: REPORT, scores, accounts, inquiries, publicRecordsReported: false, imagePages: 0,
    totalPages: 0, confidence: 1, warnings: [], reportFormat: c.activeLoan ? "merged" : "per_bureau",
    lender: c.activeLoan ? { name: "BIG MORTGAGE", requestedDate: REPORT, requestedBy: c.partner ? "Pat Partner" : null, vendor: "Xactus", reportId: "1" } : null,
    scoreReasonCodes: ["SERIOUS DELINQUENCY", "TOO MANY INQUIRIES", "LENGTH OF TIME ACCOUNTS ESTABLISHED", "PROPORTION OF BALANCES", "FIFTH"],
  };
  if (c.activeLoan) for (const a of file.accounts) a.merged = true;
  const a = buildCreditAnalysis(file, {});
  return { a, file, i: buildLeadCreditInsights(a, file, { hasReferrer: c.partner && !c.activeLoan }) };
}

const combos: Combo[] = [];
for (const middle of [540, 600, 615, 625, 700])
  for (const activeLoan of [false, true])
    for (const partner of [false, true])
      for (const inquiries of [0, 1, 4] as const)
        for (const negatives of ["none", "paid_collection", "charge_off"] as const)
          for (const openCard of [false, true]) combos.push({ middle, activeLoan, partner, inquiries, negatives, openCard, newAccount: inquiries === 4 });

describe(`invariants over ${combos.length} combinations`, () => {
  it("every combination", () => {
    for (const c of combos) {
      const name = JSON.stringify(c);
      const { a, i } = build(c);
      // Target: the next cutoff above the middle; points never negative.
      expect(i.targetScore, name).toBe(LEAD_SCORE_TARGETS.find((t) => t > c.middle) ?? 720);
      expect(i.pointsToTarget, name).toBe(Math.max(0, i.targetScore - c.middle));
      expect(i.readiness, name).toBe(leadReadiness(c.middle, i.targetScore));
      // Heat 0-100, every point backed by a reason or a partial component.
      expect(i.heatScore, name).toBeGreaterThanOrEqual(0);
      expect(i.heatScore, name).toBeLessThanOrEqual(100);
      expect(i.heatReasons.includes("active_loan_file"), name).toBe(c.activeLoan);
      expect(i.heatReasons.includes("partner_referred"), name).toBe(c.partner);
      expect(i.heatReasons.includes("shopping_inquiries"), name).toBe(c.inquiries >= 2);
      expect(i.heatReasons.includes("needs_repair"), name).toBe(c.negatives !== "none");
      // A hotter version of the same lead never scores lower.
      if (!c.activeLoan) expect(build({ ...c, activeLoan: true }).i.heatScore, name).toBeGreaterThanOrEqual(i.heatScore);
      // Negatives by type match the analysis.
      expect(i.negatives.total, name).toBe(a.negatives.length);
      expect(i.negatives.collections, name).toBe(c.negatives === "paid_collection" ? 1 : 0);
      expect(i.negatives.chargeOffs, name).toBe(c.negatives === "charge_off" ? 1 : 0);
      // Paid collection = a quick win; projections stop at Round 4 and only rise.
      expect(i.quickWins.some((q) => q.key === "paid_collections"), name).toBe(c.negatives === "paid_collection");
      if (i.projectedMiddle !== null) expect(i.projectedMiddle, name).toBeGreaterThanOrEqual(c.middle);
      if (i.roundToTarget) expect(a.projections.find((p) => p.key === `round${i.roundToTarget}`)!.middle!, name).toBeGreaterThanOrEqual(i.targetScore);
      // Estimated value = program (+ AU line when recommended); mortgage file shown with its requester.
      expect(i.estValueUsd, name).toBe((i.programTier === "complex" ? 2497 : 1497) + (i.tradelineRecommended ? 800 : 0));
      expect(i.activeLoanFile, name).toBe(c.activeLoan);
      if (c.activeLoan && c.partner) expect(i.source?.requestedBy, name).toBe("Pat Partner");
      expect(i.newAccount90d !== null, name).toBe(c.newAccount);
      expect(i.inquiries.last120d, name).toBe(c.inquiries);
      // Next action is always one of the known codes and matches the precedence rules.
      expect(i.nextAction, name).toBe(leadNextAction(i));
      expect(i.scoreFactors, name).toHaveLength(4);
    }
  });
});

describe("target, readiness and heat rules", () => {
  it.each([
    [540, null, 580], [579, null, 580], [580, null, 620], [619, null, 620], [700, null, 720], [760, null, 720], [600, 640, 640], [null, null, 620],
  ] as Array<[number | null, number | null, number]>)("middle %s, lender target %s → %s", (m, lt, t) => expect(leadTargetScore(m, lt)).toBe(t));
  it.each([
    [620, 620, "ready"], [600, 620, "close"], [590, 620, "close"], [589, 620, "long"], [null, 620, "long"],
  ] as Array<[number | null, number, string]>)("readiness %s vs %s → %s", (m, t, r) => expect(leadReadiness(m, t)).toBe(r));
  it("next action precedence", () => {
    const base = { activeLoanFile: false, source: null, noOpenCard: false, readiness: "long" as const, negatives: { total: 2, collections: 1, chargeOffs: 1, lates: 0, publicRecords: 0, repossessions: 0 }, reportFormat: "per_bureau" as const, tradelineRecommended: false };
    const by = { vendor: null, reportId: null, company: null, requestedBy: "Pat", ordered: null };
    expect(leadNextAction({ ...base, activeLoanFile: true, source: by })).toBe("call_partner_before_underwriting");
    expect(leadNextAction({ ...base, activeLoanFile: true })).toBe("call_today_active_loan");
    expect(leadNextAction({ ...base, activeLoanFile: true, noOpenCard: true, negatives: { ...base.negatives, total: 0 } })).toBe("offer_au_after_closing");
    expect(leadNextAction(base)).toBe("start_round1");
    expect(leadNextAction({ ...base, negatives: { ...base.negatives, total: 0 }, reportFormat: "merged" })).toBe("pull_full_report");
    expect(leadNextAction({ ...base, negatives: { ...base.negatives, total: 0 }, tradelineRecommended: true })).toBe("offer_au");
    expect(leadNextAction({ ...base, readiness: "ready", negatives: { ...base.negatives, total: 0 } })).toBe("ready_refer_lender");
  });
  it("heat caps at 100", () => {
    const h = leadHeatScore({ activeLoanFile: true, source: null, hasReferrer: true, inquiries: { last120d: 9, last12m: 9, sameDayMax: 9 }, newAccount90d: { creditor: "X", opened: "09/2026" }, pointsToTarget: 5, readiness: "close", quickWinsTotal: 9, negatives: { total: 3, collections: 1, chargeOffs: 1, lates: 1, publicRecords: 0, repossessions: 0 } });
    expect(h.score).toBe(100);
  });
});

describe("stage alerts between two reads", () => {
  const snap = (o: Partial<LeadCreditInsights>): LeadCreditInsights => ({ ...build({ middle: 600, activeLoan: false, partner: false, inquiries: 0, negatives: "charge_off", openCard: true, newAccount: false }).i, ...o });
  it.each([
    ["crossed 580 and 620 → reports the highest", snap({ middleScore: 570 }), snap({ middleScore: 625, targetScore: 640 }), [{ key: "score_crossed", threshold: 620, from: 570, to: 625 }]],
    ["reached the lender target", snap({ middleScore: 630, targetScore: 640 }), snap({ middleScore: 645, targetScore: 640 }), [{ key: "score_crossed", threshold: 640, from: 630, to: 645 }, { key: "target_reached", target: 640, to: 645 }]],
    ["items removed", snap({ negatives: { total: 5, collections: 2, chargeOffs: 1, lates: 2, publicRecords: 0, repossessions: 0 } }), snap({ negatives: { total: 3, collections: 1, chargeOffs: 0, lates: 2, publicRecords: 0, repossessions: 0 } }), [{ key: "negatives_removed", from: 5, to: 3 }]],
    ["new collection", snap({ negatives: { total: 1, collections: 0, chargeOffs: 0, lates: 1, publicRecords: 0, repossessions: 0 } }), snap({ negatives: { total: 2, collections: 1, chargeOffs: 0, lates: 1, publicRecords: 0, repossessions: 0 } }), [{ key: "new_derogatory", count: 1 }]],
    ["utilization under 30%", snap({ utilizationPct: 55 }), snap({ utilizationPct: 22 }), [{ key: "utilization_under_30", from: 55, to: 22 }]],
    ["score went down → no score alert", snap({ middleScore: 630 }), snap({ middleScore: 610 }), []],
    ["same read → nothing", snap({}), snap({}), []],
  ] as Array<[string, LeadCreditInsights, LeadCreditInsights, unknown[]]>)("%s", (_n, prev, next, expected) => {
    expect(leadInsightAlerts(prev, next)).toEqual(expected);
    for (const a of leadInsightAlerts(prev, next)) expect(leadInsightAlertText(a, "Jane D.")).toMatch(/^Jane D\./);
  });
  it("first read → no alerts", () => expect(leadInsightAlerts(null, snap({}))).toEqual([]));
});

describe("extra reads (group 3)", () => {
  it("student loans, medical collections, thin file, addresses, lender simulation", () => {
    const file: CreditFile = {
      provider: "unknown" as never, reportDate: REPORT, scores: { TU: 580, EX: 590, EQ: 600 }, inquiries: [],
      publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
      accounts: [
        acct("DEPT OF ED/AIDVANTAGE", "1", "installment", { balance: 22000, creditLimit: 25000, accountType: "Student Loan", dateOpened: "08/2025" }),
        acct("CITY HOSPITAL", "2", "collection", { balance: 850, paymentStatus: "Collection", remarks: "MEDICAL", dateOpened: "02/2025" }),
      ],
      identityFlags: [
        { bureau: "TU", field: "address", detail: "1 MAIN ST, AUSTIN, TX; 9 OAK AVE, MIAMI, FL" },
        { bureau: "EX", field: "address", detail: "1 MAIN ST, AUSTIN, TX" },
      ],
      lenderSimulation: "CreditXpert: no rapid-rescore plan",
    };
    const i = buildLeadCreditInsights(buildCreditAnalysis(file), file);
    expect(i.studentLoanBalance).toBe(22000);
    expect(i.medicalCollections).toEqual({ count: 1, balance: 850 });
    expect(i.thinFile).toBe(true);
    expect(i.statesSeen).toEqual(["FL", "TX"]);
    expect(i.addressCount).toBe(2);
    expect(i.lenderSimulation).toBe("CreditXpert: no rapid-rescore plan");
    expect(i.programTier).toBe("complex");
  });
});
