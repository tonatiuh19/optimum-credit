import { describe, expect, it } from "vitest";
import {
  calcMiddleScore,
  canExtractSession,
  canFinalizeSession,
  canPreviewSession,
  canReviewSession,
  expectedReportRoundForStage,
  isPdfBuffer,
  pipelineStageAfterRoundReport,
  scoresRoughlyMatchMiddle,
  validatePdfUploadPair,
  validatePublishRound,
} from "./index";

describe("pipelineStageAfterRoundReport", () => {
  it("advances to next round after report publish", () => {
    expect(pipelineStageAfterRoundReport(1)).toBe("round_2");
    expect(pipelineStageAfterRoundReport(2)).toBe("round_3");
    expect(pipelineStageAfterRoundReport(4)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(5)).toBe("completed");
  });

  it("handles edge round numbers", () => {
    expect(pipelineStageAfterRoundReport(0)).toBe("docs_ready");
    expect(pipelineStageAfterRoundReport(-1)).toBe("docs_ready");
    // Default max_rounds=5: publishing beyond max → completed
    expect(pipelineStageAfterRoundReport(6)).toBe("completed");
  });

  it("extended max stays on round_5 until final", () => {
    expect(pipelineStageAfterRoundReport(5, 8)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(6, 8)).toBe("round_5");
    expect(pipelineStageAfterRoundReport(8, 8)).toBe("completed");
  });
});

describe("validatePdfUploadPair", () => {
  it("rejects empty buffers", () => {
    expect(validatePdfUploadPair(Buffer.alloc(0), Buffer.from("%PDF-1.4"))).toBe(
      "Both PDF files are required",
    );
  });

  it("rejects non-PDF magic bytes", () => {
    expect(
      validatePdfUploadPair(Buffer.from("NOTPDF"), Buffer.from("%PDF-1.4")),
    ).toBe("Invalid PDF file — files must start with %PDF header");
  });

  it("accepts valid PDF pair under size limit", () => {
    expect(
      validatePdfUploadPair(Buffer.from("%PDF-1.4"), Buffer.from("%PDF-1.7")),
    ).toBeNull();
  });

  it("rejects oversize files", () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 0);
    big.write("%PDF", 0);
    expect(validatePdfUploadPair(big, Buffer.from("%PDF-1.4"))).toMatch(
      /4 MB/,
    );
  });

  it("allows two files that each fit under 4 MB (sequential upload path)", () => {
    const a = Buffer.alloc(3 * 1024 * 1024);
    const b = Buffer.alloc(2 * 1024 * 1024);
    a.write("%PDF", 0);
    b.write("%PDF", 0);
    expect(validatePdfUploadPair(a, b)).toBeNull();
  });

  it("rejects combined size over 8 MB (2× per-file cap)", () => {
    const a = Buffer.alloc(4 * 1024 * 1024);
    const b = Buffer.alloc(4 * 1024 * 1024 + 1);
    a.write("%PDF", 0);
    b.write("%PDF", 0);
    // b alone exceeds per-file first
    expect(validatePdfUploadPair(a, b)).toMatch(/MB or smaller/i);
  });
});

describe("isPdfBuffer", () => {
  it("detects PDF header", () => {
    expect(isPdfBuffer(Buffer.from("%PDF-1.4"))).toBe(true);
    expect(isPdfBuffer(Buffer.from("hello"))).toBe(false);
  });
});

describe("validatePublishRound", () => {
  it("allows round 1 at docs_ready", () => {
    expect(
      validatePublishRound({ roundNumber: 1, pipelineStage: "docs_ready" }),
    ).toBeNull();
  });

  it("blocks round 2 at docs_ready", () => {
    expect(
      validatePublishRound({ roundNumber: 2, pipelineStage: "docs_ready" }),
    ).toMatch(/not available/);
  });

  it("blocks round 1 when first report must be round 1 only at docs_ready", () => {
    expect(
      validatePublishRound({ roundNumber: 3, pipelineStage: "round_2" }),
    ).toMatch(/not available/);
  });

  it("allows matching round at stage", () => {
    expect(
      validatePublishRound({ roundNumber: 3, pipelineStage: "round_3" }),
    ).toBeNull();
  });

  it("blocks republish without flag", () => {
    expect(
      validatePublishRound({
        roundNumber: 2,
        pipelineStage: "round_2",
        hasExistingReport: true,
      }),
    ).toMatch(/already has a published/);
  });

  it("blocks new_client stage", () => {
    expect(
      validatePublishRound({ roundNumber: 1, pipelineStage: "new_client" }),
    ).toMatch(/cannot be published/);
  });

  it("allows extended round on round_5 with highestPublished", () => {
    expect(
      validatePublishRound({
        roundNumber: 6,
        pipelineStage: "round_5",
        maxRounds: 8,
        highestPublished: 5,
      }),
    ).toBeNull();
  });
});

describe("expectedReportRoundForStage", () => {
  it("maps stages to rounds", () => {
    expect(expectedReportRoundForStage("docs_ready")).toBe(1);
    expect(expectedReportRoundForStage("round_3")).toBe(3);
    expect(expectedReportRoundForStage("completed")).toBe(5);
    expect(expectedReportRoundForStage("new_client")).toBeNull();
  });

  it("unlocks next after R5 when extended", () => {
    expect(expectedReportRoundForStage("round_5", 8, 5)).toBe(6);
    expect(expectedReportRoundForStage("round_5", 8, 7)).toBe(8);
  });

  it("unlocks next after completed when max raised", () => {
    expect(expectedReportRoundForStage("completed", 8, 5)).toBe(6);
  });
});

describe("session state guards", () => {
  it("finalize only from review", () => {
    expect(canFinalizeSession("review")).toBe(true);
    expect(canFinalizeSession("generating")).toBe(false);
    expect(canFinalizeSession("failed")).toBe(false);
    expect(canFinalizeSession("published")).toBe(false);
  });

  it("extract blocked while extracting or published", () => {
    expect(canExtractSession("review")).toBe(true);
    expect(canExtractSession("extracting")).toBe(false);
    expect(canExtractSession("published")).toBe(false);
  });

  it("review allowed after failed extraction", () => {
    expect(canReviewSession("failed")).toBe(true);
    expect(canReviewSession("published")).toBe(false);
  });

  it("preview allowed in review and failed", () => {
    expect(canPreviewSession("review")).toBe(true);
    expect(canPreviewSession("failed")).toBe(true);
    expect(canPreviewSession("published")).toBe(false);
  });
});

describe("calcMiddleScore", () => {
  it("returns median of non-zero scores", () => {
    expect(calcMiddleScore(600, 650, 700)).toBe(650);
    expect(calcMiddleScore(0, 640, 720)).toBe(720);
    expect(calcMiddleScore(0, 0, 0)).toBe(0);
  });
});

describe("scoresRoughlyMatchMiddle", () => {
  it("flags large middle score drift", () => {
    const issues = scoresRoughlyMatchMiddle({
      middleScore: { before: 500, after: 800 },
      bureauScores: {
        transunion: { before: 600, after: 700 },
        experian: { before: 610, after: 710 },
        equifax: { before: 620, after: 720 },
      },
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("passes when middle matches bureau median", () => {
    const issues = scoresRoughlyMatchMiddle({
      middleScore: { before: 610, after: 710 },
      bureauScores: {
        transunion: { before: 600, after: 700 },
        experian: { before: 610, after: 710 },
        equifax: { before: 620, after: 720 },
      },
    });
    expect(issues).toHaveLength(0);
  });
});
