/**
 * Regenerates the inlined Credit File engine block in api/index.ts from
 * api/creditFile.ts, creditFileExtract.ts, creditAnalysisFromFile.ts, creditFileProgress.ts,
 * ofgCreditAnalysisPdf.ts, progressReportV2.ts, leadTemperature.ts and leadCreditInsights.ts (Vercel: no sibling runtime
 * imports). Run after editing either module:  node scripts/inline-credit-file-engine.mjs
 * api/creditFileEngine.sync.test.ts fails when the block is stale.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BEGIN = "// ── BEGIN inlined credit file engine (generated — do not edit) ──";
export const END = "// ── END inlined credit file engine ──";

export function buildInlineBlock() {
  const strip = (src) =>
    src
      // drop sibling imports (multi-line `import {...} from "./x";`)
      .replace(/^import[\s\S]*?from "(\.\/[^"]+|pdf-lib)";\n/gm, "")
      .replace(/^export (?=(async )?function|const|type|interface)/gm, "");
  const a = strip(fs.readFileSync(path.join(root, "api/creditFile.ts"), "utf8"));
  const b = strip(fs.readFileSync(path.join(root, "api/creditFileExtract.ts"), "utf8"));
  const c = strip(fs.readFileSync(path.join(root, "api/creditAnalysisFromFile.ts"), "utf8"));
  const d = strip(fs.readFileSync(path.join(root, "api/ofgCreditAnalysisPdf.ts"), "utf8"));
  const e = strip(fs.readFileSync(path.join(root, "api/creditFileProgress.ts"), "utf8"));
  const f = strip(fs.readFileSync(path.join(root, "api/leadTemperature.ts"), "utf8"));
  const g = strip(fs.readFileSync(path.join(root, "api/progressReportV2.ts"), "utf8"));
  const h = strip(fs.readFileSync(path.join(root, "api/leadCreditInsights.ts"), "utf8"));
  return `${BEGIN}\n${a.trim()}\n\n${b.trim()}\n\n${c.trim()}\n\n${e.trim()}\n\n${d.trim()}\n\n${f.trim()}\n\n${g.trim()}\n\n${h.trim()}\n${END}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = path.join(root, "api/index.ts");
  const src = fs.readFileSync(file, "utf8");
  const block = buildInlineBlock();
  const i = src.indexOf(BEGIN);
  const j = src.indexOf(END);
  let out;
  if (i >= 0 && j > i) {
    out = src.slice(0, i) + block + src.slice(j + END.length);
  } else {
    const anchor = "/** Curated CRM tools for Admin Ask (read + guided writes). */";
    if (!src.includes(anchor)) throw new Error("anchor not found");
    out = src.replace(anchor, `${block}\n\n${anchor}`);
  }
  fs.writeFileSync(file, out);
  console.log("inlined credit file engine:", block.length, "chars");
}
