import { describe, expect, it } from "vitest";
import { isReportRoundActive } from "./pipelineStage";

describe("isReportRoundActive", () => {
  it("unlocks only R1 at docs_ready", () => {
    expect(isReportRoundActive(1, "docs_ready")).toBe(true);
    expect(isReportRoundActive(2, "docs_ready")).toBe(false);
    expect(isReportRoundActive(5, "docs_ready")).toBe(false);
  });

  it("locks all rounds before docs_ready", () => {
    expect(isReportRoundActive(1, "prospect")).toBe(false);
    expect(isReportRoundActive(1, "new_client")).toBe(false);
  });

  it("lights rounds through current stage", () => {
    expect(isReportRoundActive(1, "round_2")).toBe(true);
    expect(isReportRoundActive(2, "round_2")).toBe(true);
    expect(isReportRoundActive(3, "round_2")).toBe(false);
  });

  it("unlocks next unpublished on round_5 when max_rounds is raised", () => {
    expect(isReportRoundActive(6, "round_5", 8, 5)).toBe(true);
    expect(isReportRoundActive(7, "round_5", 8, 5)).toBe(false);
    expect(isReportRoundActive(8, "round_5", 8, 7)).toBe(true);
    expect(isReportRoundActive(9, "round_5", 8, 7)).toBe(false);
    expect(isReportRoundActive(6, "round_5", 5, 5)).toBe(false);
  });

  it("unlocks next round after completed when max raised", () => {
    expect(isReportRoundActive(5, "completed", 5, 5)).toBe(true);
    expect(isReportRoundActive(6, "completed", 5, 5)).toBe(false);
    expect(isReportRoundActive(6, "completed", 8, 5)).toBe(true);
    expect(isReportRoundActive(7, "completed", 8, 5)).toBe(false);
  });
});
