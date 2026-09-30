import { describe, expect, it } from "vitest";
import { decodeLiteralUnicodeEscapes } from "./decodeLiteralUnicodeEscapes";

describe("decodeLiteralUnicodeEscapes (client)", () => {
  it("decodes em-dash and accented escapes", () => {
    expect(decodeLiteralUnicodeEscapes("call \\u2014 I'm busy")).toBe(
      "call — I'm busy",
    );
    expect(decodeLiteralUnicodeEscapes("cr\\u00e9dito")).toBe("crédito");
  });

  it("expands literal \\n \\t \\r (LLM double-escape)", () => {
    expect(decodeLiteralUnicodeEscapes("Hello\\n\\nWorld")).toBe(
      "Hello\n\nWorld",
    );
    expect(decodeLiteralUnicodeEscapes("a\\tb")).toBe("a\tb");
    expect(decodeLiteralUnicodeEscapes("a\\rb")).toBe("a\rb");
  });

  it("decodes unicode and newlines together", () => {
    expect(
      decodeLiteralUnicodeEscapes(
        "Hola \\u2014 listo.\\n\\nTe llamo ma\\u00f1ana.",
      ),
    ).toBe("Hola — listo.\n\nTe llamo mañana.");
  });

  it("leaves normal UTF-8 and real newlines unchanged", () => {
    expect(decodeLiteralUnicodeEscapes("call — I'm busy")).toBe(
      "call — I'm busy",
    );
    expect(decodeLiteralUnicodeEscapes("Hello\n\nWorld")).toBe(
      "Hello\n\nWorld",
    );
  });
});
