import { describe, expect, it } from "vitest";
import type { OfGReportData } from "../shared/api";
import {
  mergeClaudeBureauScores,
  needsClaudeScoreFallback,
  parseClaudeBureauScoresJson,
} from "./ofgReportClaudeEnhance";
import { extractReportDate, parseLooseDateToIso } from "./index";

const baseData = (): OfGReportData => ({
  client: { firstName: "Maria" },
  reportDate: { before: "2026-09-09", after: "2026-09-09" },
  bureauScores: {
    transunion: { before: 0, after: 0 },
    experian: { before: 0, after: 0 },
    equifax: { before: 576, after: 0 },
  },
  middleScore: { before: 576, after: 0 },
  wins: [],
  targets: [],
  utilization: [],
  positiveAccounts: [],
  actionNeeded: [],
  roadmap: {
    currentRound: 1,
    nextRound: 2,
    scoreGoal: 700,
    gapRemaining: 100,
    milestones: [],
  },
  actionPlan: [],
  fileStrengthScore: 50,
  croaDisclosure: "CROA",
  locale: "en",
});

describe("Claude bureau score fallback helpers", () => {
  it("needs fallback when bureaus missing or low confidence", () => {
    expect(needsClaudeScoreFallback(baseData())).toBe(true);
    expect(
      needsClaudeScoreFallback(
        {
          ...baseData(),
          bureauScores: {
            transunion: { before: 561, after: 561 },
            experian: { before: 580, after: 580 },
            equifax: { before: 576, after: 576 },
          },
        },
        { transunion: 0.9, experian: 0.9, equifax: 0.9 },
      ),
    ).toBe(false);
    expect(
      needsClaudeScoreFallback(
        {
          ...baseData(),
          bureauScores: {
            transunion: { before: 561, after: 561 },
            experian: { before: 580, after: 580 },
            equifax: { before: 576, after: 576 },
          },
        },
        { transunion: 0.35, experian: 0.35, equifax: 0.9 },
      ),
    ).toBe(true);
  });

  it("fills only missing scores; never overwrites deterministic values", () => {
    const draft = parseClaudeBureauScoresJson(`{
      "before": { "transunion": 561, "experian": 580, "equifax": 999 },
      "after": { "transunion": 561, "experian": 580, "equifax": 576 },
      "reportDate": { "before": "2026-06-27", "after": "2026-06-27" }
    }`);
    const { data, filled } = mergeClaudeBureauScores(baseData(), draft, {
      fillDates: true,
    });
    expect(data.bureauScores.equifax.before).toBe(576); // kept deterministic
    expect(data.bureauScores.transunion.before).toBe(561);
    expect(data.bureauScores.experian.before).toBe(580);
    expect(data.bureauScores.equifax.after).toBe(576);
    expect(data.reportDate.before).toBe("2026-06-27");
    expect(filled).toContain("before.transunion");
    expect(filled).not.toContain("before.equifax");
  });

  it("rejects invented / out-of-range Claude scores", () => {
    const { data, filled } = mergeClaudeBureauScores(baseData(), {
      before: { transunion: 100, experian: 900, equifax: null },
      after: { transunion: null, experian: null, equifax: null },
    });
    expect(filled).toEqual([]);
    expect(data.bureauScores.transunion.before).toBe(0);
  });
});

describe("extractReportDate — month names (Three Bureau / Maria)", () => {
  it("parses Report Date June 27, 2026", () => {
    expect(parseLooseDateToIso("June 27, 2026")).toBe("2026-06-27");
    expect(
      extractReportDate(
        "Equifax Experian TransUnion\nReport Date June 27, 2026 June 27, 2026 June 27, 2026",
      ),
    ).toBe("2026-06-27");
  });

  it("parses pipe header date", () => {
    expect(
      extractReportDate("Maria Ramos | June 27, 2026\n1. Report Summary"),
    ).toBe("2026-06-27");
  });
});
