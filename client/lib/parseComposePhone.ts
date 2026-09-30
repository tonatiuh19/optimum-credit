/** Strip to digits for E.164 assembly. */
export function phoneDigitsOnly(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/**
 * Parse manual phone entry in Conversations compose.
 * - 10-digit US local → +1…
 * - 11-digit starting with 1 → +1…
 * - Explicit `+` prefix → preserve country code (+52, +44, …)
 * - Other 11+ digit strings without `+` → treat as including country code
 */
export function parseComposePhoneInput(raw: string): {
  phone: string;
  label: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = phoneDigitsOnly(trimmed);
  if (digits.length < 10) return null;

  const hasExplicitPlus = trimmed.startsWith("+");
  let phone: string;
  if (hasExplicitPlus) {
    phone = `+${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    phone = `+${digits}`;
  } else if (digits.length === 10) {
    phone = `+1${digits}`;
  } else {
    phone = `+${digits}`;
  }

  const label = formatComposePhoneLabel(trimmed, digits);
  return { phone, label };
}

function formatComposePhoneLabel(trimmed: string, digits: string): string {
  if (!trimmed.startsWith("+") && digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return trimmed.replace(/\s+/g, " ").trim();
}
