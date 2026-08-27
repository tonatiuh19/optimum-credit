import { describe, expect, it } from "vitest";
import type { FundingApplication } from "@shared/api";
import { pickPortalFundingApplication } from "./fundingSlice";

const baseApp = (overrides: Partial<FundingApplication>): FundingApplication =>
  ({
    id: 1,
    funding_type: "bank_statements",
    status: "awaiting_docs",
    first_name: "A",
    last_name: "B",
    email: "a@example.test",
    preferred_language: "en",
    ...overrides,
  }) as FundingApplication;

describe("pickPortalFundingApplication", () => {
  it("returns null for empty payload", () => {
    expect(pickPortalFundingApplication(null)).toBeNull();
    expect(pickPortalFundingApplication({ applications: [] })).toBeNull();
  });

  it("unwraps applications[] and prefers open status", () => {
    const complete = baseApp({ id: 1, status: "complete" });
    const open = baseApp({ id: 2, status: "awaiting_docs" });
    expect(
      pickPortalFundingApplication({ applications: [complete, open] }),
    ).toEqual(open);
  });

  it("falls back to first row when all are terminal", () => {
    const converted = baseApp({ id: 3, status: "converted" });
    const cancelled = baseApp({ id: 4, status: "cancelled" });
    expect(
      pickPortalFundingApplication({ applications: [converted, cancelled] }),
    ).toEqual(converted);
  });

  it("supports legacy application singular", () => {
    const app = baseApp({ id: 5 });
    expect(pickPortalFundingApplication({ application: app })).toEqual(app);
  });
});
