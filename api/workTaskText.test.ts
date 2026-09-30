import { describe, expect, it } from "vitest";
import { decodeLiteralUnicodeEscapes } from "./index";

describe("decodeLiteralUnicodeEscapes", () => {
  it("decodes double-escaped LLM unicode sequences", () => {
    expect(decodeLiteralUnicodeEscapes("cr\\u00e9dito")).toBe("crédito");
    expect(decodeLiteralUnicodeEscapes("despu\\u00e9s")).toBe("después");
    expect(decodeLiteralUnicodeEscapes("d\\u00eda \\u2014 auditor\\u00eda")).toBe(
      "día — auditoría",
    );
  });

  it("leaves normal UTF-8 and plain text unchanged", () => {
    expect(decodeLiteralUnicodeEscapes("crédito")).toBe("crédito");
    expect(decodeLiteralUnicodeEscapes("hello")).toBe("hello");
  });

  it("expands literal \\n (SMS thread visible escapes)", () => {
    expect(decodeLiteralUnicodeEscapes("updates.\\n\\nTo give")).toBe(
      "updates.\n\nTo give",
    );
  });
});
