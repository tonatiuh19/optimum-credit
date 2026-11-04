/**
 * Permanent regression — Spec v2.1 §9 acceptance test (Cesar, Oct 20 2026).
 * Fixture = the Claude read of a real Factual Data tri-merge (Rocket Mortgage
 * pull), anonymized (name, addresses, account numbers replaced). Every
 * expected value below comes from the spec's acceptance table. Add a fixture
 * + test here for every report that ever comes out wrong.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { CreditFile } from "./creditFile";
import { buildCreditAnalysis, parseReportDate } from "./creditAnalysisFromFile";

const load = (name: string): CreditFile =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "credit-files", name), "utf8"));

describe("Spec v2.1 §9 — Factual Data tri-merge, active mortgage", () => {
  const file = load("factual-data-trimerge-active-loan.json");
  const a = buildCreditAnalysis(file);
  const round = (r: number) => a.negatives.filter((n) => n.round === r).map((n) => n.creditor);

  it("reads the merged format, borrower name, lender and both score models", () => {
    expect(file.reportFormat).toBe("merged");
    expect(a.borrowerName).toBe("JANE QUINN SAMPLE");
    expect(a.scores).toEqual({ TU: 578, EX: 585, EQ: 634 });
    expect(a.middleScore).toBe(585);
    expect(a.vantageScores).toEqual({ TU: 616, EX: 618, EQ: 639 });
  });

  it("ISO dates parse (avg age / oldest from Date Opened on every tradeline)", () => {
    expect(parseReportDate("2011-08-08")?.toISOString().slice(0, 10)).toBe("2011-08-08");
    expect(a.totals!.oldest?.creditor).toBe("DEPT OF ED/AIDVANTAGE");
    expect(a.totals!.avgAgeMonths).toBeGreaterThanOrEqual(77);
    expect(a.totals!.avgAgeMonths).toBeLessThanOrEqual(80);
  });

  // v2.4 #3: utilization covers open cards in good standing only, tri-merges included.
  it("totals: 10 with balances, 9 negative tradelines / 8 unique accounts, open cards in good standing", () => {
    expect(a.totals!.withBalance).toBe(10);
    expect(a.totals!.negativeTradelines).toBe(9);
    expect(a.totals!.negativeAccounts).toBe(8);
    expect(a.totals!.revolvingBalance).toBe(1400);
    expect(a.totals!.revolvingLimit).toBe(1550); // $1,050 + $500 (closed / derogatory lines no longer count)
    expect(a.totals!.pastDue).toBe(36122);
    expect(a.totals!.totalBalance).toBe(105605);
  });

  it("active transaction: lender report, Rocket Mortgage inquiry excluded, primary line held", () => {
    expect(a.escrow.active).toBe(true);
    expect(a.escrow.source).toBe("lender_report");
    const rocket = a.inquiries.find((q) => /rocket/i.test(q.creditor))!;
    expect(rocket.action).toBe("permissible");
    expect(rocket.excludedReason).toBe("active_loan");
    expect(a.tradelines.find((t) => t.code === "primary")?.timing).toBe("hold");
    expect(a.tradelines.find((t) => t.code === "IH-1")?.timing).toBe("after_closing");
    expect(a.inquiryClusters).toEqual([]); // P0-5: no one-inquiry "cluster"
  });

  it("Round 1: Reprise only; Carvana EXCLUDED (Bridgecrest opened 09/2026); bureaus Not itemized", () => {
    const targets = a.inquiries.filter((q) => q.action === "dispute");
    expect(targets.map((q) => q.creditor)).toEqual(["REPRISE FINANCIAL/WEBB"]);
    expect(targets.every((q) => q.bureau === null)).toBe(true);
    // Cesar (Oct 22): Carvana is Bridgecrest's dealer → the pull opened that loan → not a dispute.
    const carvana = a.inquiries.find((q) => /carvana/i.test(q.creditor))!;
    expect(carvana).toMatchObject({ action: "permissible", excludedReason: "matches_account" });
    expect(carvana.lowerOdds).toMatch(/BRIDGECREST opened 09\/2026/);
  });

  it("Round 2: the medical collection on XP + TU only", () => {
    expect(round(2)).toEqual(["I.C. SYSTEM, INC"]);
    expect(a.negatives.find((n) => n.round === 2)!.bureaus.sort()).toEqual(["EX", "TU"]);
  });

  it("Round 3: late-payment accounts only, incl. the Express duplicate pair", () => {
    expect(round(3).sort()).toEqual(
      ["CAPITAL ONE", "CCB/EXPRESS", "COMENITYCAPITAL/EXPR", "MACYS/CBNA", "SYNCB/JCP", "TARGET/TD"].sort(),
    );
    const exp = a.negatives.filter((n) => /EXPR/.test(n.creditor));
    expect(exp).toHaveLength(2);
    expect(exp[0].duplicateGroup).not.toBeNull();
    expect(exp[0].duplicateGroup).toBe(exp[1].duplicateGroup);
    expect(a.negatives.find((n) => n.creditor === "CCB/EXPRESS")!.bureaus).toEqual(["TU"]);
  });

  it("Round 4: charge-offs with accuracy flags (balance > high credit, re-aging), joint shown", () => {
    expect(round(4).sort()).toEqual(["GM FINANCIAL", "ONEMAIN"]);
    const gm = a.negatives.find((n) => n.creditor === "GM FINANCIAL")!;
    expect(gm.joint).toBe(true);
    expect(gm.accuracyFlags!.join(" ")).toMatch(/balance \$29,108 exceeds \$21,319 high credit/);
    const om = a.negatives.find((n) => n.creditor === "ONEMAIN")!;
    expect(om.accuracyFlags!.join(" ")).toMatch(/re-aging/);
  });

  it("positives are never dispute targets; prior dispute remark is informational", () => {
    expect(a.accuracyUpdates).toEqual([]);
    expect(a.selfCheck!.items.find((i) => i.key === "positives_in_rounds")!.ok).toBe(true);
    expect(a.informational!.map((i) => i.creditor)).toEqual(["DEPT OF ED/AIDVANTAGE"]);
  });

  it("projection model: capped ranges, middle score rises step by step, never past 760", () => {
    const mids = a.projections.map((p) => p.middle!);
    expect(mids[0]).toBe(585);
    for (let i = 1; i < mids.length; i++) expect(mids[i]).toBeGreaterThanOrEqual(mids[i - 1]);
    const last = a.projections[a.projections.length - 1];
    for (const b of ["TU", "EX", "EQ"] as const) {
      expect(last.scores[b]!).toBeLessThanOrEqual(760);
      expect(last.scores[b]! - a.scores[b]!).toBeLessThanOrEqual(100);
    }
    expect(a.programTier).toBe("complex");
  });

  it("self-check gate: the read is one revolving account short of the summary (29) → blocked", () => {
    const accounts = a.selfCheck!.items.find((i) => i.key === "accounts")!;
    expect(accounts.expected).toBe("29");
    expect(accounts.ok).toBe(false);
    expect(a.selfCheck!.ok).toBe(false);
    // Everything else reconciles.
    for (const k of ["balances", "past_due", "lates", "scores", "name"] as const) {
      expect(a.selfCheck!.items.find((i) => i.key === k)!.ok).toBe(true);
    }
  });
});
