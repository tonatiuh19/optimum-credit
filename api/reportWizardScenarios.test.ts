import { describe, expect, it } from "vitest";
import type { OfGReportData } from "../shared/api";
import {
  buildConfidence,
  computeFileStrengthScore,
  detectProvider,
  diffItems,
  extractAllScores,
  middleScore,
  validateReportCompliance,
} from "./index";

const sampleData = (): OfGReportData => ({
  client: { firstName: "Alex" },
  reportDate: { before: "2026-01-01", after: "2026-02-01" },
  bureauScores: {
    transunion: { before: 580, after: 620 },
    experian: { before: 590, after: 630 },
    equifax: { before: 600, after: 640 },
  },
  middleScore: { before: 590, after: 630 },
  wins: [{ itemRemoved: "ABC Collection", bureaus: ["TU"], impact: "", status: "Removed" }],
  targets: [{ item: "Capital One charge-off", bureaus: ["EX"], detail: "", priority: "high" }],
  utilization: [],
  positiveAccounts: [],
  actionNeeded: [],
  roadmap: {
    currentRound: 1,
    nextRound: 2,
    scoreGoal: 670,
    gapRemaining: 40,
    milestones: [],
  },
  actionPlan: [{ step: 1, description: "Pay on time", owner: "client" }],
  fileStrengthScore: 50,
  croaDisclosure:
    "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA).",
});

describe("detectProvider", () => {
  it("detects known vendors", () => {
    expect(detectProvider("Welcome to IdentityIQ report")).toBe("identityiq");
    expect(detectProvider("SmartCredit dashboard")).toBe("smartcredit");
    expect(detectProvider("MyScoreIQ summary")).toBe("myscoreiq");
    expect(detectProvider("Generic credit report")).toBe("generic");
  });
});

describe("extractAllScores", () => {
  it("parses IdentityIQ-style score lines", () => {
    const text = `
      TransUnion Score: 612
      Experian Score: 598
      Equifax Score: 605
    `;
    const scores = extractAllScores(text, "identityiq");
    expect(scores.transunion).toBe(612);
    expect(scores.experian).toBe(598);
    expect(scores.equifax).toBe(605);
    expect(middleScore(scores)).toBe(605);
  });

  it("returns null for missing bureaus", () => {
    const scores = extractAllScores("No scores here", "generic");
    expect(scores.transunion).toBeNull();
    expect(middleScore(scores)).toBeNull();
  });

  it("rejects out-of-range scores", () => {
    const text = "TransUnion Score: 999";
    expect(extractAllScores(text, "identityiq").transunion).toBeNull();
  });
});

describe("diffItems", () => {
  it("is case-insensitive and trims", () => {
    expect(
      diffItems(
        ["  ABC Collection ", "Late Payment"],
        ["abc collection", "Other"],
      ),
    ).toEqual(["Late Payment"]);
  });

  it("returns empty when nothing removed", () => {
    expect(diffItems(["Same item"], ["Same item"])).toEqual([]);
  });
});

describe("buildConfidence", () => {
  it("low confidence when bureau missing", () => {
    const c = buildConfidence(
      { transunion: 600, experian: null, equifax: 610 },
      { transunion: 620, experian: null, equifax: 630 },
    );
    expect(c.experian).toBe(0.4);
    expect(c.transunion).toBe(0.9);
  });
});

describe("computeFileStrengthScore", () => {
  it("rewards wins and penalizes targets", () => {
    const high = computeFileStrengthScore(500, 3, 1);
    const low = computeFileStrengthScore(500, 0, 8);
    expect(high).toBeGreaterThan(low);
  });
});

describe("validateReportCompliance", () => {
  it("passes valid sample data", () => {
    const result = validateReportCompliance(sampleData());
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("requires after scores", () => {
    const data = sampleData();
    data.middleScore.after = 0;
    data.bureauScores.transunion.after = 0;
    data.bureauScores.experian.after = 0;
    data.bureauScores.equifax.after = 0;
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(
      /after score/i,
    );
  });

  it("blocks guarantee language", () => {
    const data = sampleData();
    data.wins[0].itemRemoved = "We guarantee 100 point increase";
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(
      /Compliance issue/,
    );
  });

  it("warns on implausible score drop (soft — does not hard-block)", () => {
    const data = sampleData();
    data.bureauScores.transunion.before = 750;
    data.bureauScores.transunion.after = 500;
    const result = validateReportCompliance(data);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/dropped more than 150/);
  });

  it("blocks invalid tradeline code", () => {
    const data = sampleData();
    data.tradelineRecommendation = {
      code: "BAD-CODE",
      projectedImpact: "Projected improvement",
    };
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/IH-N/);
  });
});
