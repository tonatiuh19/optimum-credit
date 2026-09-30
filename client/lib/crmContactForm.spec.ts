import { describe, expect, it } from "vitest";
import {
  buildCrmContactFormSchema,
  isValidCrmContactEmail,
  normalizeCrmContactPhone,
} from "./crmContactForm";

describe("isValidCrmContactEmail", () => {
  it("accepts normal emails", () => {
    expect(isValidCrmContactEmail("a@b.co")).toBe(true);
    expect(isValidCrmContactEmail("  Name@Example.COM ")).toBe(true);
  });

  it("rejects incomplete emails", () => {
    expect(isValidCrmContactEmail("")).toBe(false);
    expect(isValidCrmContactEmail("nope")).toBe(false);
    expect(isValidCrmContactEmail("a@b")).toBe(false);
    expect(isValidCrmContactEmail("@b.com")).toBe(false);
  });
});

describe("normalizeCrmContactPhone", () => {
  it("returns null for empty", () => {
    expect(normalizeCrmContactPhone("")).toBeNull();
    expect(normalizeCrmContactPhone("   ")).toBeNull();
  });

  it("normalizes US 10-digit to +1", () => {
    expect(normalizeCrmContactPhone("(555) 123-4567")).toBe("+15551234567");
  });

  it("keeps international E.164", () => {
    expect(normalizeCrmContactPhone("+52 55 1234 5678")).toBe("+525512345678");
  });

  it("rejects short numbers", () => {
    expect(normalizeCrmContactPhone("555-1234")).toBeNull();
  });
});

describe("buildCrmContactFormSchema", () => {
  const schema = buildCrmContactFormSchema();

  it("requires first and last name", async () => {
    await expect(
      schema.validate({
        first_name: "",
        last_name: "X",
        email: "a@b.co",
        phone: "",
        preferred_language: "en",
        admin_notes: "",
      }),
    ).rejects.toThrow();
  });

  it("requires email or phone", async () => {
    await expect(
      schema.validate({
        first_name: "A",
        last_name: "B",
        email: "",
        phone: "",
        preferred_language: "en",
        admin_notes: "",
      }),
    ).rejects.toThrow(/Email or phone/i);
  });

  it("rejects invalid phone when provided", async () => {
    await expect(
      schema.validate({
        first_name: "A",
        last_name: "B",
        email: "",
        phone: "123",
        preferred_language: "en",
        admin_notes: "",
      }),
    ).rejects.toThrow(/valid phone/i);
  });

  it("accepts phone-only contact", async () => {
    const v = await schema.validate({
      first_name: "A",
      last_name: "B",
      email: "",
      phone: "5551234567",
      preferred_language: "es",
      admin_notes: "",
    });
    expect(v.phone).toBe("5551234567");
  });

  it("accepts email-only contact", async () => {
    const v = await schema.validate({
      first_name: "A",
      last_name: "B",
      email: "lead@example.com",
      phone: "",
      preferred_language: "en",
      admin_notes: "note",
    });
    expect(v.email).toBe("lead@example.com");
  });
});
