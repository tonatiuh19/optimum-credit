import { describe, expect, it } from "vitest";
import { resolveCleanupRunId } from "./testDbCleanup";

describe("resolveCleanupRunId", () => {
  it("accepts { runId } object", () => {
    expect(resolveCleanupRunId({ runId: "pipe-123" }, "t")).toBe("pipe-123");
  });

  it("accepts bare string for backward compat", () => {
    expect(resolveCleanupRunId("gridpg-1", "t")).toBe("gridpg-1");
  });

  it("throws on missing/empty runId (prevents silent %undefined% deletes)", () => {
    expect(() => resolveCleanupRunId(undefined, "t")).toThrow(/expected \{ runId/);
    expect(() => resolveCleanupRunId({} as any, "t")).toThrow(/expected \{ runId/);
    expect(() => resolveCleanupRunId("", "t")).toThrow(/empty runId/);
  });
});
