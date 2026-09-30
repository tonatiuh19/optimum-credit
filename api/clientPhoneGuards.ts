/**
 * Pure phone / spam guards for client create paths.
 * Keep in sync with inlined copies in api/index.ts (Vercel: no sibling runtime import).
 */

export const PLACEHOLDER_PHONE_LAST10 = new Set([
  "0000000000",
  "1111111111",
  "2222222222",
  "3333333333",
  "4444444444",
  "5555555555",
  "6666666666",
  "7777777777",
  "8888888888",
  "9999999999",
  "1234567890",
  "0123456789",
  "0987654321",
]);

export function normalizePhoneLast10Pure(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Fake / staff-placeholder phones that must never create a client. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  const last10 = normalizePhoneLast10Pure(phone);
  if (!last10) return false;
  if (PLACEHOLDER_PHONE_LAST10.has(last10)) return true;
  if (/^(\d)\1{9}$/.test(last10)) return true;
  return false;
}

/**
 * Likely bot / gibberish person names (public Get Started spam).
 * Conservative: only flags when both names look synthetic.
 */
export function looksLikeSpamPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): boolean {
  const first = String(firstName || "")
    .trim()
    .toLowerCase();
  const last = String(lastName || "")
    .trim()
    .toLowerCase();
  if (!first || !last) return false;

  const junkExact = new Set([
    "test",
    "testing",
    "demo",
    "asdf",
    "qwerty",
    "xxx",
    "sample",
    "fake",
    "none",
    "n/a",
    "na",
    "tbd",
    "unknown",
    "crmcontact",
  ]);
  if (junkExact.has(first) || junkExact.has(last)) return true;
  if (first.includes("test") && last.includes("test")) return true;

  const lettersOnly = (s: string) => s.replace(/[^a-z]/g, "");
  const vowelRatio = (s: string) => {
    const letters = lettersOnly(s);
    if (letters.length < 3) return 1;
    const vowels = (letters.match(/[aeiou]/g) || []).length;
    return vowels / letters.length;
  };

  const f = lettersOnly(first);
  const l = lettersOnly(last);
  // Consonant soup (e.g. Wgbok Hhbegaysv, Vimb Mzqof)
  if (
    f.length >= 4 &&
    l.length >= 4 &&
    vowelRatio(f) <= 0.26 &&
    vowelRatio(l) <= 0.26
  ) {
    return true;
  }

  // High-entropy lowercase blobs with few vowels
  if (/^[a-z]{5,}$/.test(f) && /^[a-z]{5,}$/.test(l)) {
    const entropy = (s: string) => new Set(s).size / s.length;
    if (
      entropy(f) >= 0.8 &&
      entropy(l) >= 0.8 &&
      vowelRatio(f) < 0.3 &&
      vowelRatio(l) < 0.3
    ) {
      return true;
    }
  }

  return false;
}

/** Dotted Gmail locals common in bot signups: a.b.c.d.e@gmail.com */
export function looksLikeSpamEmail(email: string | null | undefined): boolean {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (!e || !e.includes("@")) return false;
  const [local, domain] = e.split("@");
  if (!local || !domain) return false;
  if (domain.endsWith(".test") || domain === "example.com") return true;
  const dotParts = local.split(".").filter(Boolean);
  if (dotParts.length >= 4 && domain === "gmail.com") return true;
  return false;
}

export const WEB_LEAD_REVIEW_LABEL = "web_lead_review";
