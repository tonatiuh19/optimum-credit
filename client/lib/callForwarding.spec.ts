import { describe, expect, it } from "vitest";
import { isInternationalForwardingNumber } from "@/lib/callForwarding";

describe("isInternationalForwardingNumber", () => {
  it("flags non-US numbers such as Mexico", () => {
    expect(isInternationalForwardingNumber("+52 33 1234 6834")).toBe(true);
  });
  it("does not flag US/Canada or local-format numbers", () => {
    expect(isInternationalForwardingNumber("+1 949 555 1234")).toBe(false);
    expect(isInternationalForwardingNumber("9495551234")).toBe(false);
    expect(isInternationalForwardingNumber("")).toBe(false);
  });
});
