import { describe, expect, it } from "vitest";
import { parseSignInSheet, signInSheetPhoneDigits } from "./eventSignInSheet";

const opts = { attended: true, lang: "es" as const };

describe("parseSignInSheet", () => {
  it("reads comma lines, Excel tabs, optional email in any later column", () => {
    const { rows, errors } = parseSignInSheet(
      [
        "First name, Last name, Phone, Email",
        "Maria, Lopez, (909) 555-1234, Maria@Email.com",
        "Juan\tPerez\t+1 909 555 6789",
        "Ana; Ruiz; ana@x.com; 909.555.0000",
        "",
      ].join("\n"),
      opts,
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { first_name: "Maria", last_name: "Lopez", phone: "(909) 555-1234", email: "maria@email.com", preferred_language: "es", attended: true },
      { first_name: "Juan", last_name: "Perez", phone: "+1 909 555 6789", preferred_language: "es", attended: true },
      { first_name: "Ana", last_name: "Ruiz", phone: "909.555.0000", email: "ana@x.com", preferred_language: "es", attended: true },
    ]);
  });

  it("reports the line number and reason for bad rows", () => {
    const { rows, errors } = parseSignInSheet(
      ["Maria, , 9095551234", "Juan, Perez, 555-12", "Ana, Ruiz, 9095550000, ana@", "9095551234, Lopez, 9095551234"].join("\n"),
      opts,
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { line: 1, error: "name_required" },
      { line: 2, error: "invalid_phone" },
      { line: 3, error: "invalid_email" },
      { line: 4, error: "name_required" },
    ]);
  });

  it("normalizes US phone digits", () => {
    expect(signInSheetPhoneDigits("+1 (909) 555-1234")).toBe("9095551234");
    expect(signInSheetPhoneDigits("909-555-12")).toBe("90955512");
  });
});
