import { describe, expect, it } from "vitest";
import type { OfGReportData } from "../shared/api";
import {
  mergeClaudeNarrativeEnhancement,
  parseClaudeNarrativeJson,
} from "./ofgReportClaudeEnhance";

function baseReport(): OfGReportData {
  return {
    client: { firstName: "Maria" },
    reportDate: { before: "2026-01-01", after: "2026-06-01" },
    bureauScores: {
      transunion: { before: 580, after: 620 },
      experian: { before: 590, after: 630 },
      equifax: { before: 575, after: 615 },
    },
    middleScore: { before: 580, after: 620 },
    wins: [
      {
        itemRemoved: "CAPITAL ONE — Collection",
        bureaus: ["TU", "EX"],
        impact: "Removed from report",
        status: "Removed",
      },
    ],
    targets: [
      {
        item: "Chase inquiry",
        bureaus: ["EQ"],
        detail: "Still reporting",
        priority: "medium",
      },
    ],
    utilization: [
      {
        account: "Amex",
        limit: 5000,
        balance: 2000,
        pctUsed: 40,
        payTo30: 500,
        payTo10: 1500,
      },
    ],
    positiveAccounts: ["Amex — paid as agreed"],
    actionNeeded: ["Amex high util"],
    roadmap: {
      currentRound: 1,
      nextRound: 2,
      scoreGoal: 660,
      gapRemaining: 40,
      milestones: ["Round 1 done"],
    },
    actionPlan: [
      { step: 1, description: "Keep paying on time", owner: "client" },
    ],
    fileStrengthScore: 72,
    croaDisclosure: "CROA text",
    locale: "en",
  };
}

describe("mergeClaudeNarrativeEnhancement", () => {
  it("never overwrites scores, utilization, or roadmap score numbers", () => {
    const base = baseReport();
    const out = mergeClaudeNarrativeEnhancement(base, {
      actionPlan: [
        { step: 1, description: "OFG will dispute remaining inquiries", owner: "ofg" },
        { step: 2, description: "Client keeps utilization under 30%", owner: "client" },
      ],
      wins: [
        {
          itemRemoved: "CAPITAL ONE — Collection",
          impact: "Collection deleted — strong win this round",
          status: "Removed",
        },
      ],
      roadmap: {
        milestones: ["Round 1 complete", "Round 2 focus"],
        scoreGoal: 800,
        gapRemaining: 1,
      },
    });
    expect(out.bureauScores).toEqual(base.bureauScores);
    expect(out.middleScore).toEqual(base.middleScore);
    expect(out.utilization).toEqual(base.utilization);
    expect(out.croaDisclosure).toBe(base.croaDisclosure);
    expect(out.roadmap.scoreGoal).toBe(base.roadmap.scoreGoal);
    expect(out.roadmap.gapRemaining).toBe(base.roadmap.gapRemaining);
    expect(out.roadmap.milestones).toEqual([
      "Round 1 complete",
      "Round 2 focus",
    ]);
    expect(out.wins[0].impact).toMatch(/strong win/i);
    expect(out.actionPlan).toHaveLength(2);
  });

  it("ignores unmatched draft wins (no by-index fallback)", () => {
    const out = mergeClaudeNarrativeEnhancement(baseReport(), {
      wins: [
        {
          itemRemoved: "SOME OTHER ACCOUNT",
          impact: "should not apply",
          status: "Removed",
        },
      ],
    });
    expect(out.wins[0].impact).toBe("Removed from report");
  });

  it("rejects non IH tradeline codes", () => {
    const out = mergeClaudeNarrativeEnhancement(baseReport(), {
      tradelineRecommendation: {
        code: "John Smith AU",
        projectedImpact: "bad",
      },
    });
    expect(out.tradelineRecommendation).toBeUndefined();
  });

  it("accepts IH-coded tradeline recommendation", () => {
    const out = mergeClaudeNarrativeEnhancement(baseReport(), {
      tradelineRecommendation: {
        code: "ih-2",
        projectedImpact: "Projected file thickness support",
      },
    });
    expect(out.tradelineRecommendation?.code).toBe("IH-2");
  });
});

describe("parseClaudeNarrativeJson", () => {
  it("extracts JSON object from fenced text", () => {
    const draft = parseClaudeNarrativeJson(
      'Here you go:\n```json\n{"actionPlan":[{"step":1,"description":"Pay on time","owner":"client"}]}\n```',
    );
    expect(draft?.actionPlan?.[0]?.description).toMatch(/Pay on time/);
  });
});
