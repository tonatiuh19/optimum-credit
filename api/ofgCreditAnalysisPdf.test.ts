import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCreditAnalysis } from "./creditAnalysisFromFile";
import { FILE } from "./creditAnalysisFixtures";
import { actionPlan, displayBorrowerName, generateOfgCreditAnalysisPdf, isPlaceholderName, keyObservations, pdfSafe } from "./ofgCreditAnalysisPdf";

const program = {
  standardPrice: "$1,497",
  complexPrice: "$2,497",
  standardUrl: "optimum-financial-group.com/premium-plan-payment",
  complexUrl: "optimum-financial-group.com/complex-repair-payment",
  mfsnUrl: "https://app.myfreescorenow.com/credit-snapshot/29544",
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

  it("renders exactly 5 pages (Spec §8) in English with legal bases intact", async () => {
    const buf = await generateOfgCreditAnalysisPdf(data, { clientName: "Test Client", lang: "en", program });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(5);
    const text = await pdfText(buf);
    expect(text).toContain("FDCPA §809");
    expect(text).toContain("FLAGGED - EQUIFAX");
    expect(text).toContain("INFORMATIONAL - NOT DISPUTE TARGETS");
    expect(text).toContain("Standard Repair - $1,497");
    expect(text).toContain("premium-plan-payment");
    expect(text).toContain("myfreescorenow.com");
  });

  it("Complex program links to /complex-repair-payment (P0-11)", async () => {
    const buf = await generateOfgCreditAnalysisPdf({ ...data, programTier: "complex" }, { clientName: "Test Client", lang: "en", program });
    const text = await pdfText(buf);
    expect(text).toContain("Complex Repair - $2,497");
    expect(text).toContain("complex-repair-payment");
    expect(text).not.toContain("premium-plan-payment");
  });

  it("renders Spanish labels (no English table headers)", async () => {
    const buf = await generateOfgCreditAnalysisPdf(data, { clientName: "Cliente", lang: "es", program });
    const text = await pdfText(buf);
    expect(text).toContain("Analisis de Credito");
    expect(text).toContain("Prioridad de disputas");
    expect(text).not.toMatch(/\bMilestone\b|\bLegal basis\b/);
  });

  it("observations are facts only; action plan names real items (max 6)", () => {
    const obs = keyObservations(data, false);
    expect(obs.join(" ")).not.toMatch(/holding|is the item|drives? the score/i);
    expect(obs.length).toBeLessThanOrEqual(6);
    const plan = actionPlan(data, false);
    expect(plan.some((s) => /lift any freeze on EQ/i.test(s))).toBe(true);
    expect(plan.some((s) => /^Rounds? 2/.test(s))).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(6);
  });

  it("placeholder names never print; borrower name is formatted (P0-1)", () => {
    expect(isPlaceholderName("(last name TBD)")).toBe(true);
    expect(isPlaceholderName("Alma (last name TBD)")).toBe(true);
    expect(isPlaceholderName("Alma Rice")).toBe(false);
    // Spec v2.3 P2-2: the full borrower name as printed, never abbreviated.
    expect(displayBorrowerName("ALMA YVETTE RICE")).toBe("Alma Yvette Rice");
    expect(displayBorrowerName("LAILA LOUISE REAVES ELHASSANI")).toBe("Laila Louise Reaves Elhassani");
  });

  it("keeps PDF text WinAnsi-safe", () => {
    expect(pdfSafe("A — B “x” §611\n")).toBe('A - B "x" §611');
  });
});
