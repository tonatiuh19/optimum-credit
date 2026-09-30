import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MAX_ROUNDS,
  cascadeRoundsFrom,
  clampMaxRounds,
  expectedReportRoundForStage,
  extendedRoundsLegend,
  isExtendedRoundsCase,
  pipelineStageAfterRoundReport,
  validatePublishRoundNumber,
} from "./extendedRounds";

describe("clampMaxRounds", () => {
  it("defaults and caps", () => {
    expect(clampMaxRounds(undefined)).toBe(5);
    expect(clampMaxRounds(3)).toBe(5);
    expect(clampMaxRounds(8)).toBe(8);
    expect(clampMaxRounds(99)).toBe(ABSOLUTE_MAX_ROUNDS);
  });
});

describe("pipelineStageAfterRoundReport", () => {
  it("standard 5-round program", () => {
    expect(pipelineStageAfterRoundReport(1, 5)).toBe("round_2");
    expect(pipelineStageAfterRoundReport(4, 5)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(5, 5)).toBe("completed");
  });

  it("extended: stay on round_5 until final", () => {
    expect(pipelineStageAfterRoundReport(5, 8)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(6, 8)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(7, 8)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(8, 8)).toBe("completed");
  });
});

describe("expectedReportRoundForStage", () => {
  it("unlocks next round after R5 when extended", () => {
    expect(expectedReportRoundForStage("round_5", 8, 5)).toBe(6);
    expect(expectedReportRoundForStage("round_5", 8, 6)).toBe(7);
    expect(expectedReportRoundForStage("round_5", 8, 8)).toBe(8);
  });

  it("standard stage mapping unchanged", () => {
    expect(expectedReportRoundForStage("docs_ready", 5, 0)).toBe(1);
    expect(expectedReportRoundForStage("round_2", 5, 1)).toBe(2);
    expect(expectedReportRoundForStage("completed", 5, 5)).toBe(5);
  });

  it("unlocks next after completed when max raised past published", () => {
    expect(expectedReportRoundForStage("completed", 8, 5)).toBe(6);
    expect(expectedReportRoundForStage("completed", 8, 7)).toBe(8);
    expect(expectedReportRoundForStage("completed", 8, 8)).toBe(8);
  });
});

describe("validatePublishRoundNumber / cascade / legend", () => {
  it("validates against max", () => {
    expect(validatePublishRoundNumber(6, 5)).toMatch(/1–5/);
    expect(validatePublishRoundNumber(6, 8)).toBeNull();
    expect(validatePublishRoundNumber(12, 12)).toBeNull();
  });

  it("cascades through max", () => {
    expect(cascadeRoundsFrom(5, 8)).toEqual([5, 6, 7, 8]);
  });

  it("legend only for extended", () => {
    expect(isExtendedRoundsCase(5)).toBe(false);
    expect(extendedRoundsLegend({ maxRounds: 5 })).toBeNull();
    expect(
      extendedRoundsLegend({ maxRounds: 8, highestPublished: 6 }),
    ).toBe("Special · R6/8");
  });
});
