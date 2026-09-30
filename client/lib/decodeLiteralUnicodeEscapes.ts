/**
 * LLM / JSON sometimes stores escapes as literal text (`\u2014`, `\n`, `\t`)
 * instead of the real characters. Decode for display and before SMS/store.
 * Keep in sync with api/index.ts `decodeLiteralUnicodeEscapes`.
 */
export function decodeLiteralUnicodeEscapes(input: string): string {
  if (!input || !input.includes("\\")) return input;
  // Fast path: only care about common LLM double-escapes.
  if (!/\\[nrtu]/.test(input)) return input;
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}
