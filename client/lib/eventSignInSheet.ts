import type { EventImportRow } from "@shared/api";

export type SignInSheetError = {
  line: number;
  error: "name_required" | "invalid_phone" | "invalid_email";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits of a US phone (drops a leading country 1). */
export function signInSheetPhoneDigits(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * Parses a pasted paper sign-in sheet: one person per line, columns
 * first name, last name, phone, email (optional). Accepts Excel/Sheets
 * pastes (tabs) or comma/semicolon lists; skips blank lines and a header row.
 * Email may sit in any column after the name (detected by "@").
 */
export function parseSignInSheet(
  text: string,
  opts: { attended: boolean; lang: "en" | "es" },
): { rows: EventImportRow[]; errors: SignInSheetError[] } {
  const rows: EventImportRow[] = [];
  const errors: SignInSheetError[] = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const cells = line
      .split(line.includes("\t") ? /\t/ : /[,;]/)
      .map((c) => c.trim())
      .filter((c, idx, arr) => c !== "" || idx < 2 || arr.slice(idx).some(Boolean));
    if (i === 0 && /first|nombre/i.test(cells[0] || "") && !/\d/.test(line)) return;
    const email = cells.find((c) => c.includes("@")) || "";
    const rest = cells.filter((c) => c !== email);
    const phoneCell = rest.slice(2).find((c) => /\d/.test(c)) || "";
    const [firstName = "", lastName = ""] = rest;
    const lineNo = i + 1;
    if (!firstName || !lastName || /\d/.test(firstName) || /\d/.test(lastName)) {
      errors.push({ line: lineNo, error: "name_required" });
      return;
    }
    if (signInSheetPhoneDigits(phoneCell).length !== 10) {
      errors.push({ line: lineNo, error: "invalid_phone" });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ line: lineNo, error: "invalid_email" });
      return;
    }
    rows.push({
      first_name: firstName,
      last_name: lastName,
      phone: phoneCell,
      ...(email ? { email: email.toLowerCase() } : {}),
      preferred_language: opts.lang,
      attended: opts.attended,
    });
  });
  return { rows, errors };
}
