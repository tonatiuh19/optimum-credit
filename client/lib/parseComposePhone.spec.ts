import { describe, expect, it } from "vitest";
import { parseComposePhoneInput } from "./parseComposePhone";

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

  it("preserves leading 1 for 11-digit US numbers", () => {
    expect(parseComposePhoneInput("1-555-123-4567")).toEqual({
      phone: "+15551234567",
      label: "1-555-123-4567",
    });
  });

  it("accepts US numbers with dotted +1 formatting", () => {
    expect(parseComposePhoneInput("+1.555.123.4567")).toEqual({
      phone: "+15551234567",
      label: "+1.555.123.4567",
    });
  });

  it("preserves +52 Mexico E.164", () => {
    expect(parseComposePhoneInput("+52 55 1234 5678")).toEqual({
      phone: "+525512345678",
      label: "+52 55 1234 5678",
    });
  });

  it("preserves other international + prefixes", () => {
    expect(parseComposePhoneInput("+44 20 7946 0958")).toEqual({
      phone: "+442079460958",
      label: "+44 20 7946 0958",
    });
  });

  it("treats long digit strings without + as including country code", () => {
    expect(parseComposePhoneInput("525512345678")).toEqual({
      phone: "+525512345678",
      label: "525512345678",
    });
  });
});
