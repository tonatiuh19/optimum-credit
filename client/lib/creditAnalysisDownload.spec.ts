import { describe, expect, it } from "vitest";
import { creditAnalysisPdfFileName } from "@/lib/creditAnalysisDownload";

describe("creditAnalysisDownload", () => {
  it("builds a stable PDF filename", () => {
    expect(
      creditAnalysisPdfFileName({
        firstName: "Ruth",
        lastName: "Flores",
        generatedAt: "2026-09-01T12:00:00.000Z",
      }),
    ).toBe("optimum-credit-analysis-Ruth-Flores-2026-09-01.pdf");
  });
});
