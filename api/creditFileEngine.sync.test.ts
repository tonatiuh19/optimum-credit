/**
 * Drift guard: api/index.ts inlines api/creditFile.ts + api/creditFileExtract.ts
 * (Vercel monolith — no sibling runtime imports). Regenerate with
 *   node scripts/inline-credit-file-engine.mjs
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BEGIN, END, buildInlineBlock } from "../scripts/inline-credit-file-engine.mjs";

describe("credit file engine ↔ api/index.ts sync", () => {
  it("inlined block matches the source modules", () => {
    const src = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const i = src.indexOf(BEGIN);
    const j = src.indexOf(END);
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, j + END.length)).toBe(buildInlineBlock());
  });
});
