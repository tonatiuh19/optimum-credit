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
});
