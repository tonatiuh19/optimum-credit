/**
 * A bureau with no score (Nov 2, 2026 — Lecca, a client): SmartCredit prints the names on one
 * line and "694 673 ——" below. The review form must keep each score under its own bureau,
 * never slide TransUnion's number to Equifax. Reports with all three scores are unchanged.
 */
import { describe, expect, it } from "vitest";
import { extractAllScores } from "./index";
import { parseSmartCredit } from "./creditFile";
import type { Bureau, CreditFile } from "./creditFile";
import { generateProgressReportV2Pdf, generateScoreUpdatePdf, pv2BuildPdfData, pv2Diff, type Pv2RenderStats } from "./progressReportV2";

const HEAD = "Credit Scores\nPersonal Information\nCredit Report Date\nName\nSummary\nTotal Accounts\n";
const page = (row: string, header = "TransUnion® \tExperian® \tEquifax®") =>
  `${HEAD}${header}\n${row}\n${header}\n10/22/2026 \t10/22/2026 \t——\nDORRIAN \tDORRIAN \t——\nCAP ONE 517805****\nClosed\n${header}\n—— \t—— \t620\n`;

describe("extractAllScores: one-line bureau header", () => {
  it.each([
    ["Equifax missing", "694 \t673 \t——", { transunion: 694, experian: 673, equifax: null }],
    ["Experian missing", "638 \t—— \t631", { transunion: 638, experian: null, equifax: 631 }],
    ["TransUnion missing", "—— \t673 \t655", { transunion: null, experian: 673, equifax: 655 }],
    ["only one score", "—— \t—— \t655", { transunion: null, experian: null, equifax: 655 }],
    ["a 0 means no score", "694 \t0 \t655", { transunion: 694, experian: null, equifax: 655 }],
    ["N/A means no score", "694 \tN/A \t655", { transunion: 694, experian: null, equifax: 655 }],
  ])("%s", (_n, row, want) => {
    expect(extractAllScores(page(row), "smartcredit")).toEqual(want);
  });

  it("follows the printed bureau order", () => {
    expect(extractAllScores(page("601 \t—— \t640", "Equifax® \tExperian® \tTransUnion®"), "smartcredit")).toEqual({ equifax: 601, experian: null, transunion: 640 });
  });

  it("all three present: unchanged, and a later account row is never used as scores", () => {
    expect(extractAllScores(page("694 \t673 \t655"), "smartcredit")).toEqual({ transunion: 694, experian: 673, equifax: 655 });
  });

  it("no scores at all: an account table cell never becomes a score", () => {
    const r = extractAllScores(page("—— \t—— \t——"), "smartcredit");
    expect(r.transunion).toBeNull();
    expect(r.experian).toBeNull();
  });

  it("stacked headers keep working", () => {
    expect(extractAllScores(`${HEAD}TransUnion®\nExperian®\nEquifax®\n638 \t—— \t631\n`, "smartcredit")).toEqual({ transunion: 638, experian: null, equifax: 631 });
  });
});

describe("parseSmartCredit: 0 keeps its column", () => {
  it("694 0 655", () => {
    expect(parseSmartCredit("TransUnion® \tExperian® \tEquifax®\n694 \t0 \t655\n").scores).toEqual({ TU: 694, EX: null, EQ: 655 });
  });
});

describe("client PDFs: a bureau with no score says so; the middle score stays --", () => {
  const scores = { TU: { before: 667, after: 694 }, EX: { before: 654, after: 673 }, EQ: { before: null, after: null } } as Record<Bureau, { before: number | null; after: number | null }>;
  const text = async (buf: Buffer) => {
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    return (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
  };
  const f = (d: string) => ({ provider: "smartcredit", reportDate: d, scores: { TU: 667, EX: 654, EQ: null }, accounts: [], inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 9, confidence: 1, warnings: [] }) as unknown as CreditFile;

  it.each([["en", "No score"], ["es", "Sin puntaje"]] as const)("progress report (%s)", async (lang, label) => {
    const pdf = pv2BuildPdfData({ diff: pv2Diff(f("06/01/2026"), f("10/01/2026"), lang), clientFirstName: "Ana", clientName: "Ana B", round: 2, scores: scores as any, phone: "x", site: "x", lang });
    const stats: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
    const t = await text(await generateProgressReportV2Pdf(pdf, null, stats));
    expect(t).toContain(`Equifax ${label} ${label} --`);
    expect(t).toContain("TransUnion 667 694 +27");
    expect(t).toMatch(/(Middle|Medio|Puntaje medio)[a-z ]* -- -- --/i);
  }, 30_000);

  it.each([["en", "No score"], ["es", "Sin puntaje"]] as const)("score update (%s)", async (lang, label) => {
    const empty = { before: null, after: null };
    const t = await text(await generateScoreUpdatePdf({ lang, clientName: "Ana B", clientFirstName: "Ana", round: 2, baselineDate: "06/01/2026", currentDate: "10/01/2026", scores, inquiries: { counts: { TU: empty, EX: empty, EQ: empty }, removed: [], verified: false, reason: "x" }, phone: "x", site: "x" }));
    expect(t).toContain(`Equifax ${label} ${label} --`);
    expect(t).toMatch(/(Middle|Medio|Puntaje medio)[a-z ]* -- -- --/i);
  });

  it("a score on only one report keeps the real number", async () => {
    const empty = { before: null, after: null };
    const t = await text(await generateScoreUpdatePdf({ lang: "en", clientName: "Ana B", clientFirstName: "Ana", round: 2, baselineDate: "06/01/2026", currentDate: "10/01/2026", scores: { ...scores, EQ: { before: null, after: 640 } }, inquiries: { counts: { TU: empty, EX: empty, EQ: empty }, removed: [], verified: false, reason: "x" }, phone: "x", site: "x" }));
    expect(t).toContain("Equifax No score 640 --");
  });
});

