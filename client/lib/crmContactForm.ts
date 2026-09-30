import * as Yup from "yup";
import { parseComposePhoneInput } from "@/lib/parseComposePhone";

/** Stricter than Yup's default `.email()` — requires a dotted domain. */
export function isValidCrmContactEmail(raw: string): boolean {
  const email = String(raw || "").trim().toLowerCase();
  if (!email) return false;
  if (email.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Normalize contact phone for storage (E.164 when possible).
 * Returns null for empty; throws-style via Yup when invalid.
 */
export function normalizeCrmContactPhone(
  raw: string | null | undefined,
): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const parsed = parseComposePhoneInput(trimmed);
  if (!parsed) return null;
  // contacts.phone is VARCHAR(20)
  return parsed.phone.slice(0, 20);
}

export function buildCrmContactFormSchema(opts?: { t?: (key: string) => string }) {
  const msg = (key: string, fallback: string) =>
    opts?.t ? opts.t(key) : fallback;

  return Yup.object({
    first_name: Yup.string()
      .trim()
      .max(100)
      .required(msg("adminContacts.errFirstNameRequired", "First name is required")),
    last_name: Yup.string()
      .trim()
      .max(100)
      .required(msg("adminContacts.errLastNameRequired", "Last name is required")),
    email: Yup.string()
      .trim()
      .transform((v, orig) => {
        const raw =
          typeof orig === "string" ? orig.trim() : String(v ?? "").trim();
        return raw === "" ? null : raw.toLowerCase();
      })
      .nullable()
      .notRequired()
      .max(255)
      .test(
        "email-format",
        msg("common.invalidEmail", "Invalid email"),
        (v) => v == null || v === "" || isValidCrmContactEmail(v),
      ),
    phone: Yup.string()
      .trim()
      .transform((v, orig) => {
        const raw =
          typeof orig === "string" ? orig.trim() : String(v ?? "").trim();
        return raw === "" ? null : raw;
      })
      .nullable()
      .notRequired()
      .test(
        "phone-format",
        msg(
          "adminContacts.errPhoneInvalid",
          "Enter a valid phone (10+ digits, e.g. (555) 123-4567 or +52…)",
        ),
        (v) => {
          if (v == null || v === "") return true;
          return normalizeCrmContactPhone(v) != null;
        },
      ),
    preferred_language: Yup.string()
      .oneOf(["en", "es"])
      .required(msg("adminContacts.errLanguageRequired", "Language is required")),
    admin_notes: Yup.string().trim().nullable().max(5000),
    address_line1: Yup.string().trim().nullable().max(255),
    address_line2: Yup.string().trim().nullable().max(255),
    city: Yup.string().trim().nullable().max(100),
    state: Yup.string().trim().nullable().max(50),
    zip: Yup.string().trim().nullable().max(20),
  }).test("contact-required", function (values) {
    const email = String(values?.email ?? "").trim();
    const phone = String(values?.phone ?? "").trim();
    if (email || phone) return true;
    return this.createError({
      path: "email",
      message: msg(
        "adminContacts.errEmailOrPhone",
        "Email or phone is required",
      ),
    });
  });
}

export type CrmContactFormValues = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_language: "en" | "es";
  admin_notes: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
};
