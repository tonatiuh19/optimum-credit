import { describe, expect, it } from "vitest";
import { isIntegrationTestEmail } from "./testDbCleanup";

describe("isIntegrationTestEmail", () => {
  it("flags vitest mailbox domains", () => {
    expect(isIntegrationTestEmail("conv-agent-x@example.test")).toBe(true);
    expect(isIntegrationTestEmail("x@affiliate.test")).toBe(true);
    expect(isIntegrationTestEmail("  Y@Example.Test  ")).toBe(true);
  });

  it("allows real staff domains", () => {
    expect(isIntegrationTestEmail("axgoomez@gmail.com")).toBe(false);
    expect(isIntegrationTestEmail("team@ofgllc.com")).toBe(false);
    expect(isIntegrationTestEmail(null)).toBe(false);
  });
});
