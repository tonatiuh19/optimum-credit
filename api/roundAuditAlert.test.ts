import { describe, expect, it } from "vitest";
import { parseRoundAuditConfig } from "./index";

describe("round 6+ audit alert config", () => {
  it("defaults to Lecca at round 6", () => {
    expect(parseRoundAuditConfig({})).toEqual({ adminIds: [150002], minRound: 6 });
  });
  it("accepts several reviewers and a custom threshold", () => {
    expect(
      parseRoundAuditConfig({ ROUND_AUDIT_ALERT_ADMIN_IDS: "150002, 120001", ROUND_AUDIT_MIN_ROUND: "7" }),
    ).toEqual({ adminIds: [150002, 120001], minRound: 7 });
  });
  it("ignores invalid values", () => {
    expect(parseRoundAuditConfig({ ROUND_AUDIT_ALERT_ADMIN_IDS: "x,,0", ROUND_AUDIT_MIN_ROUND: "1" })).toEqual({
      adminIds: [],
      minRound: 6,
    });
  });
});
