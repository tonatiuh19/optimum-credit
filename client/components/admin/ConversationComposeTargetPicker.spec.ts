import { describe, expect, it } from "vitest";
import { parseComposePhoneInput } from "./ConversationComposeTargetPicker";

describe("parseComposePhoneInput", () => {
  it("returns null for too few digits", () => {
    expect(parseComposePhoneInput("555-1234")).toBeNull();
    expect(parseComposePhoneInput("")).toBeNull();
  });

  it("normalizes 10-digit US numbers to +1 E.164", () => {
    expect(parseComposePhoneInput("(555) 123-4567")).toEqual({
      phone: "+15551234567",
      label: "(555) 123-4567",
    });
  });

  it("preserves leading 1 for 11-digit numbers", () => {
    expect(parseComposePhoneInput("1-555-123-4567")).toEqual({
      phone: "+15551234567",
      label: "(555) 123-4567",
    });
  });

  it("accepts numbers with dotted formatting", () => {
    expect(parseComposePhoneInput("+1.555.123.4567")).toEqual({
      phone: "+15551234567",
      label: "(555) 123-4567",
    });
  });
});
