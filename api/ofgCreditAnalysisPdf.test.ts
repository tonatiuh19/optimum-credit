import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCreditAnalysis } from "./creditAnalysisFromFile";
import { FILE } from "./creditAnalysisFixtures";
import { actionPlan, generateOfgCreditAnalysisPdf, keyObservations, pdfSafe } from "./ofgCreditAnalysisPdf";

const program = {
  standardPrice: "$1,497",
  complexPrice: "$2,497",
  enrollUrl: "optimum-financial-group.com/premium-plan-payment",
  phone: "(949) 736-5644",
  site: "optimum-financial-group.com",
};

async function pdfText(buf: Buffer): Promise<string> {
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: buf }).getText()).text;
}

describe("generateOfgCreditAnalysisPdf", () => {
  const data = buildCreditAnalysis(FILE);

  it("renders a compact branded PDF in English with legal bases intact", async () => {
    const buf = await generateOfgCreditAnalysisPdf(data, { clientName: "Test Client", lang: "en", program });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeLessThanOrEqual(4);
    const text = await pdfText(buf);
    expect(text).toContain("FDCPA §809");
    expect(text).toContain("FLAGGED - EQUIFAX");
    expect(text).toContain("ON HOLD");
    expect(text).toContain("Standard Repair - $1,497");
  });

  it("renders Spanish labels (no English table headers)", async () => {
    const buf = await generateOfgCreditAnalysisPdf(data, { clientName: "Cliente", lang: "es", program });
    const text = await pdfText(buf);
    expect(text).toContain("Analisis de Credito");
    expect(text).toContain("Ultima actividad:");
    expect(text).not.toMatch(/\bMilestone\b|\bImpact\b/);
  });

  it("builds data-driven observations and action plan", () => {
    // Observations and steps name the real items (spec: no generic text).
    const obs = keyObservations(data, false);
    expect(obs[0]).toMatch(/^JEFFERSON CAPITAL: Collection on TU, EX/);
    expect(obs.length).toBeLessThanOrEqual(6);
    const plan = actionPlan(data, false);
    expect(plan[0]).toMatch(/lift any freeze on EQ/);
    expect(plan.some((s) => s.startsWith("Round 2 - Collections:"))).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(6);
  });

  it("keeps PDF text WinAnsi-safe", () => {
    expect(pdfSafe("A — B “x” §611\n")).toBe('A - B "x" §611');
  });
});
