import { describe, expect, it } from "vitest";
import {
  CLIENT_AUTOMATION_HOLD_STATUSES,
  isClientAutomationHoldStatus,
} from "./index";

describe("client automation hold (paused / blocked)", () => {
  it("holds automations for paused and blocked clients", () => {
    expect(CLIENT_AUTOMATION_HOLD_STATUSES).toEqual(["paused", "blocked"]);
    expect(isClientAutomationHoldStatus("paused")).toBe(true);
    expect(isClientAutomationHoldStatus("blocked")).toBe(true);
  });

  it("never holds working, prospect or cancelled clients", () => {
    for (const st of [
      "prospect",
      "funding",
      "pending_payment",
      "onboarding",
      "active",
      "cancelled",
      "",
      null,
      undefined,
    ]) {
      expect(isClientAutomationHoldStatus(st)).toBe(false);
    }
  });
});
