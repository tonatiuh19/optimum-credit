import { describe, expect, it } from "vitest";
import {
  isPlaceholderPhone,
  looksLikeSpamEmail,
  looksLikeSpamPersonName,
  normalizePhoneLast10Pure,
} from "./clientPhoneGuards";

describe("isPlaceholderPhone", () => {
  it("rejects all-zero / all-nine / sequential fakes", () => {
    expect(isPlaceholderPhone("0000000000")).toBe(true);
    expect(isPlaceholderPhone("9999999999")).toBe(true);
    expect(isPlaceholderPhone("+1 (999) 999-9999")).toBe(true);
    expect(isPlaceholderPhone("1234567890")).toBe(true);
    expect(isPlaceholderPhone("1111111111")).toBe(true);
  });

  it("allows real-looking numbers", () => {
    expect(isPlaceholderPhone("+13237180001")).toBe(false);
    expect(isPlaceholderPhone("(562) 916-5794")).toBe(false);
  });
});

describe("looksLikeSpamPersonName", () => {
  it("flags gibberish pairs", () => {
    expect(looksLikeSpamPersonName("Wgbok", "Hhbegaysv")).toBe(true);
    expect(looksLikeSpamPersonName("Vimb", "Mzqof")).toBe(true);
    expect(looksLikeSpamPersonName("Test", "User")).toBe(true);
  });

  it("allows normal names", () => {
    expect(looksLikeSpamPersonName("Maria", "Hernandez")).toBe(false);
    expect(looksLikeSpamPersonName("Sofia", "Calvo")).toBe(false);
    expect(looksLikeSpamPersonName("Jose", "Morales")).toBe(false);
  });
});

describe("looksLikeSpamEmail", () => {
  it("flags dotted gmail bots and .test domains", () => {
    expect(looksLikeSpamEmail("ep.ey.axo.j.o.860@gmail.com")).toBe(true);
    expect(looksLikeSpamEmail("crm-contact@example.test")).toBe(true);
  });

  it("allows normal emails", () => {
    expect(looksLikeSpamEmail("rocioh231@gmail.com")).toBe(false);
    expect(looksLikeSpamEmail("abel_tapia10@ymail.com")).toBe(false);
  });
});

describe("normalizePhoneLast10Pure", () => {
  it("strips to last 10 digits", () => {
    expect(normalizePhoneLast10Pure("+1 (323) 718-0001")).toBe("3237180001");
    expect(normalizePhoneLast10Pure("short")).toBeNull();
  });
});
