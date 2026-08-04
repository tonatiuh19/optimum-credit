/**
 * Prospects + pipeline stage rules — regression coverage for locked decisions.
 */
import { describe, expect, it } from "vitest";
import {
  canDragProspect,
  shouldConfirmStageMove,
  isForwardStageMove,
  isBackwardStageMove,
  pipelineStageIndex,
  inferAnalysisLabelSlugs,
  resolveExtractionStatus,
  buildProspectAnalysisHtml,
  missingRequiredLabelSlugs,
} from "./index";

describe("pipeline stage order", () => {
  it("places prospect before new_client", () => {
    expect(pipelineStageIndex("prospect")).toBeLessThan(
      pipelineStageIndex("new_client"),
    );
  });

  it("detects forward and backward moves", () => {
    expect(isForwardStageMove("new_client", "docs_ready")).toBe(true);
    expect(isBackwardStageMove("docs_ready", "new_client")).toBe(true);
    expect(isForwardStageMove("round_1", "round_1")).toBe(false);
  });

  it("requires confirm on any stage change (6C)", () => {
    expect(shouldConfirmStageMove("new_client", "docs_ready")).toBe(true);
    expect(shouldConfirmStageMove("round_3", "round_1")).toBe(true);
    expect(shouldConfirmStageMove("round_1", "completed")).toBe(true);
    expect(shouldConfirmStageMove("docs_ready", "docs_ready")).toBe(false);
  });

  it("only allows prospect → new_client drag (1C/5A)", () => {
    expect(canDragProspect("prospect", "new_client")).toBe(true);
    expect(canDragProspect("prospect", "docs_ready")).toBe(false);
    expect(canDragProspect("new_client", "prospect")).toBe(false);
  });
});

describe("inferAnalysisLabelSlugs", () => {
  it("maps housing / auto / card / collections language", () => {
    const text = `
      MORTGAGE LATE PAYMENT
      AUTO LOAN CHARGE OFF
      CREDIT CARD COLLECTION
      STUDENT LOAN DELINQUENT
      MEDICAL COLLECTION
      BANKRUPTCY CHAPTER 7
      HARD INQUIRY EXPERIAN
    `;
    const negatives = [
      "Mortgage - late payment",
      "Auto Loan - charge off",
      "Capital One Credit Card - collection",
      "Navient Student Loan - delinquent",
      "Medical Collection Agency",
      "Bankruptcy filing",
      "Hard Inquiry from lender",
    ];
    const slugs = inferAnalysisLabelSlugs(negatives, text);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "housing",
        "auto",
        "credit_card",
        "collections",
        "student_loan",
        "medical",
        "bankruptcy",
        "inquiry",
      ]),
    );
  });

  it("falls back to other_derogatory when nothing matches", () => {
    const slugs = inferAnalysisLabelSlugs(
      ["Unknown tradeline issue XYZ"],
      "generic credit report text without keywords",
    );
    expect(slugs).toContain("other_derogatory");
  });
});

describe("resolveExtractionStatus", () => {
  it("flags non-PDF uploads as unsupported_type regardless of text", () => {
    expect(resolveExtractionStatus("image/png", "", false)).toBe(
      "unsupported_type",
    );
    expect(
      resolveExtractionStatus("image/png", "some long extracted text here", false),
    ).toBe("unsupported_type");
  });

  it("flags a thrown pdf-parse error as parse_failed even with no text", () => {
    expect(resolveExtractionStatus("application/pdf", "", true)).toBe(
      "parse_failed",
    );
  });

  it("flags a pdf that parsed but yielded < 80 chars as empty", () => {
    expect(resolveExtractionStatus("application/pdf", "short", false)).toBe(
      "empty",
    );
    expect(
      resolveExtractionStatus("application/pdf", "   \n  ", false),
    ).toBe("empty");
  });

  it("returns ok for a pdf that parsed with substantial text", () => {
    const longText = "A".repeat(200);
    expect(resolveExtractionStatus("application/pdf", longText, false)).toBe(
      "ok",
    );
  });
});

describe("missingRequiredLabelSlugs — reminder audience gate", () => {
  it("passes when no labels are required", () => {
    expect(missingRequiredLabelSlugs([], [])).toEqual([]);
    expect(missingRequiredLabelSlugs(["housing"], [])).toEqual([]);
  });

  it("passes when the client holds every required slug", () => {
    expect(
      missingRequiredLabelSlugs(
        ["web_analysis", "housing", "collections"],
        ["housing", "collections"],
      ),
    ).toEqual([]);
  });

  it("returns only the missing required slugs", () => {
    expect(
      missingRequiredLabelSlugs(["web_analysis"], ["housing", "collections"]),
    ).toEqual(["housing", "collections"]);
    expect(
      missingRequiredLabelSlugs(["housing"], ["housing", "collections"]),
    ).toEqual(["collections"]);
  });
});

describe("buildProspectAnalysisHtml — weak extraction messaging", () => {
  const baseOpts = {
    firstName: "Jamie",
    scores: { transunion: null, experian: null, equifax: null },
    negatives: [],
    clientGoal: null,
  };

  it("shows the honest good-news message when extraction is ok and no negatives found", () => {
    const { html, text } = buildProspectAnalysisHtml({
      ...baseOpts,
      weakExtraction: false,
    });
    expect(html).toMatch(/didn't detect any obvious negative items/i);
    expect(text).toMatch(/didn't detect any obvious negative items/i);
  });

  it("never claims 'good news / no negatives' when extraction was weak", () => {
    const { html, text } = buildProspectAnalysisHtml({
      ...baseOpts,
      weakExtraction: true,
    });
    expect(html).not.toMatch(/good news/i);
    expect(html).not.toMatch(/didn't detect any obvious negative items/i);
    expect(html).toMatch(/couldn't reliably read your report/i);
    expect(html).toMatch(/text-based SmartCredit PDF/i);
    expect(text).toMatch(/couldn't reliably read your report/i);
  });

  it("derives weakness from extractionStatus when weakExtraction is omitted", () => {
    const { html } = buildProspectAnalysisHtml({
      ...baseOpts,
      extractionStatus: "parse_failed",
    });
    expect(html).toMatch(/couldn't reliably read your report/i);
  });

  it("shows the Spanish weak-extraction message when lang=es", () => {
    const { html } = buildProspectAnalysisHtml({
      ...baseOpts,
      lang: "es",
      weakExtraction: true,
    });
    expect(html).toMatch(/no pudimos leer tu informe/i);
  });
});
