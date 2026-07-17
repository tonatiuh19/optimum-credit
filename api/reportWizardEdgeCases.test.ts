/**
 * Edge-case and gap-hunting tests for OFG Progress Report Wizard helpers.
 * Covers PDF validation, round gating, score extraction, join/diff,
 * compliance hard vs soft, and real-world mis-upload scenarios.
 */
import { describe, expect, it } from "vitest";
import type { OfGReportData } from "../shared/api";
import {
  buildConfidence,
  calcMiddleScore,
  canExtractSession,
  canFinalizeSession,
  canPreviewSession,
  canReviewSession,
  computeFileStrengthScore,
  detectNegativeLines,
  detectProvider,
  diffItems,
  expectedReportRoundForStage,
  extractAllScores,
  extractPositiveAccounts,
  extractUtilization,
  isPdfBuffer,
  middleScore,
  pipelineStageAfterRoundReport,
  scoresRoughlyMatchMiddle,
  toPdfSafeText,
  validatePdfUploadPair,
  validatePublishRound,
  validateReportCompliance,
} from "./index";

const sampleData = (overrides: Partial<OfGReportData> = {}): OfGReportData => ({
  client: { firstName: "Alex" },
  reportDate: { before: "2026-01-01", after: "2026-06-01" },
  bureauScores: {
    transunion: { before: 580, after: 620 },
    experian: { before: 590, after: 630 },
    equifax: { before: 600, after: 640 },
  },
  middleScore: { before: 590, after: 630 },
  wins: [
    {
      itemRemoved: "ABC Collection",
      bureaus: ["TU"],
      impact: "Removed from report",
      status: "Removed",
    },
  ],
  targets: [
    {
      item: "Capital One charge-off",
      bureaus: ["EX"],
      detail: "Still reporting",
      priority: "high",
    },
  ],
  utilization: [],
  positiveAccounts: [],
  actionNeeded: [],
  roadmap: {
    currentRound: 1,
    nextRound: 2,
    scoreGoal: 670,
    gapRemaining: 40,
    milestones: ["Round 1 progress documented"],
  },
  actionPlan: [{ step: 1, description: "Pay on time", owner: "client" }],
  fileStrengthScore: 50,
  croaDisclosure:
    "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA).",
  ...overrides,
});

// ── PDF upload edge cases ────────────────────────────────────────────────────

describe("validatePdfUploadPair — edge cases", () => {
  it("rejects nullish / undefined-like empty inputs", () => {
    expect(validatePdfUploadPair(Buffer.alloc(0), Buffer.alloc(0))).toMatch(
      /Both PDF/,
    );
  });

  it("accepts files exactly at the 15 MB limit", () => {
    const limit = 15 * 1024 * 1024;
    const a = Buffer.alloc(limit);
    const b = Buffer.alloc(limit);
    a.write("%PDF", 0);
    b.write("%PDF", 0);
    expect(validatePdfUploadPair(a, b)).toBeNull();
  });

  it("rejects one valid + one invalid magic", () => {
    expect(
      validatePdfUploadPair(Buffer.from("%PDF-1.4"), Buffer.from("JFIF")),
    ).toMatch(/Invalid PDF/);
  });

  it("rejects tiny buffers that look like PDF but are too short for magic", () => {
    expect(isPdfBuffer(Buffer.from("%PD"))).toBe(false);
    expect(isPdfBuffer(Buffer.alloc(0))).toBe(false);
  });

  it("custom maxBytes is respected", () => {
    const buf = Buffer.alloc(100);
    buf.write("%PDF", 0);
    expect(validatePdfUploadPair(buf, buf, 50)).toMatch(/MB or smaller/i);
  });
});

// ── Round / pipeline gating ──────────────────────────────────────────────────

describe("validatePublishRound — edge cases", () => {
  it.each([0, -1, 6, 99])("rejects invalid round %i", (roundNumber) => {
    expect(
      validatePublishRound({ roundNumber, pipelineStage: "docs_ready" }),
    ).toMatch(/1–5|1-5/);
  });

  it("allows republish when flag set", () => {
    expect(
      validatePublishRound({
        roundNumber: 2,
        pipelineStage: "round_2",
        hasExistingReport: true,
        allowRepublish: true,
      }),
    ).toBeNull();
  });

  it("allows earlier round while ahead in pipeline (round_4 can publish round_3?)", () => {
    // expected for round_4 stage is 4; round 3 <= 4 so allowed
    expect(
      validatePublishRound({ roundNumber: 3, pipelineStage: "round_4" }),
    ).toBeNull();
  });

  it("blocks cancelled and unknown stages", () => {
    expect(
      validatePublishRound({ roundNumber: 1, pipelineStage: "cancelled" }),
    ).toMatch(/cannot be published/);
    expect(
      validatePublishRound({ roundNumber: 1, pipelineStage: "unknown_stage" }),
    ).toMatch(/cannot be published/);
  });

  it("completed stage maps to round 5 expected", () => {
    expect(expectedReportRoundForStage("completed")).toBe(5);
    expect(
      validatePublishRound({ roundNumber: 5, pipelineStage: "completed" }),
    ).toBeNull();
  });
});

describe("pipelineStageAfterRoundReport — full matrix", () => {
  it.each([
    [1, "round_2"],
    [2, "round_3"],
    [3, "round_4"],
    [4, "round_5"],
    [5, "completed"],
  ] as const)("round %i → %s", (round, stage) => {
    expect(pipelineStageAfterRoundReport(round)).toBe(stage);
  });
});

describe("session state machine — all statuses", () => {
  const statuses = [
    "draft",
    "extracting",
    "review",
    "generating",
    "published",
    "failed",
  ] as const;

  it("extract matrix", () => {
    for (const s of statuses) {
      const ok = canExtractSession(s);
      if (s === "published" || s === "extracting") expect(ok).toBe(false);
      else expect(ok).toBe(true);
    }
  });

  it("review matrix", () => {
    expect(canReviewSession("draft")).toBe(true);
    expect(canReviewSession("review")).toBe(true);
    expect(canReviewSession("failed")).toBe(true);
    expect(canReviewSession("extracting")).toBe(false);
    expect(canReviewSession("generating")).toBe(false);
    expect(canReviewSession("published")).toBe(false);
  });

  it("preview matrix includes generating (orphan recovery)", () => {
    expect(canPreviewSession("generating")).toBe(true);
    expect(canPreviewSession("published")).toBe(false);
  });

  it("finalize only review", () => {
    for (const s of statuses) {
      expect(canFinalizeSession(s)).toBe(s === "review");
    }
  });
});

// ── Score extraction edge cases ──────────────────────────────────────────────

describe("extractAllScores — edge cases", () => {
  it("parses SmartCredit-style labels", () => {
    const text = `
      SmartCredit Report
      TransUnion FICO Score 603
      Experian FICO Score 632
      Equifax FICO Score 551
    `;
    const scores = extractAllScores(text, "smartcredit");
    expect(scores.transunion).toBe(603);
    expect(scores.experian).toBe(632);
    expect(scores.equifax).toBe(551);
  });

  it("parses abbreviated TU/EX/EQ lines", () => {
    const text = "TU: 610\nEX: 620\nEQ: 630";
    const scores = extractAllScores(text, "generic");
    expect(scores.transunion).toBe(610);
    expect(scores.experian).toBe(620);
    expect(scores.equifax).toBe(630);
  });

  it("ignores scores below 300 and above 850", () => {
    const text = "TransUnion Score: 250\nExperian Score: 900\nEquifax Score: 700";
    const scores = extractAllScores(text, "identityiq");
    expect(scores.transunion).toBeNull();
    expect(scores.experian).toBeNull();
    expect(scores.equifax).toBe(700);
  });

  it("boundary scores 300 and 850 are accepted", () => {
    const text = "TransUnion Score: 300\nExperian Score: 850\nEquifax Score: 500";
    const scores = extractAllScores(text, "identityiq");
    expect(scores.transunion).toBe(300);
    expect(scores.experian).toBe(850);
  });

  it("does not confuse OFG progress report page labels with bureau scores", () => {
    // Simulated OFG progress PDF text that caused Equifax 747 mis-read risk
    const ofgLike = `
      OFG Progress Report
      Page 1 of 3
      File Strength Score: 100
      Middle score 632
      Round 1
    `;
    const scores = extractAllScores(ofgLike, "generic");
    // Should not invent TU/EX/EQ from "Score: 100" alone without bureau label
    expect(scores.transunion).toBeNull();
    expect(scores.experian).toBeNull();
  });

  it("auto-detects provider then extracts", () => {
    const text = `
      Smart Credit monitoring
      TransUnion Score: 601
      Experian Score: 602
      Equifax Score: 603
    `;
    expect(detectProvider(text)).toBe("smartcredit");
    const scores = extractAllScores(text);
    expect(middleScore(scores)).toBe(602);
  });
});

describe("middleScore / calcMiddleScore — edge cases", () => {
  it("median with two values uses higher of sorted floor", () => {
    // vals [600,700] → floor(1) = 700
    expect(calcMiddleScore(600, 0, 700)).toBe(700);
    expect(middleScore({ transunion: 600, experian: null, equifax: 700 })).toBe(
      700,
    );
  });

  it("single bureau only", () => {
    expect(calcMiddleScore(0, 0, 640)).toBe(640);
    expect(
      middleScore({ transunion: null, experian: null, equifax: 640 }),
    ).toBe(640);
  });
});

// ── Join / diff / negatives ──────────────────────────────────────────────────

describe("detectNegativeLines — edge cases", () => {
  it("finds collection / charge-off / late lines", () => {
    const text = `
      MIDLAND FUNDING - Collection account $450
      CAPITAL ONE charge-off balance
      Late payment on AMEX
      Current account Chase
    `;
    const neg = detectNegativeLines(text);
    expect(neg.some((l) => /midland/i.test(l))).toBe(true);
    expect(neg.some((l) => /capital one/i.test(l))).toBe(true);
    expect(neg.every((l) => !/chase/i.test(l) || /late|collection|charge/i.test(l))).toBe(
      true,
    );
  });

  it("dedupes case-insensitively", () => {
    const text = `
      ABC Collection account
      abc collection account
      ABC Collection account
    `;
    const neg = detectNegativeLines(text);
    expect(neg.length).toBe(1);
  });

  it("ignores very short or very long lines", () => {
    const text = `Late\n${"X".repeat(200)} collection account\nNormal Collection account here`;
    const neg = detectNegativeLines(text);
    expect(neg.every((l) => l.length <= 100)).toBe(true);
  });

  it("caps at 25 items", () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `Creditor${i} Collection account`,
    ).join("\n");
    expect(detectNegativeLines(lines).length).toBeLessThanOrEqual(25);
  });
});

describe("diffItems — join before/after", () => {
  it("treats removals as wins (before − after)", () => {
    const before = ["Midland Collection", "Late Payment CapOne", "Hard Inquiry XYZ"];
    const after = ["Late Payment CapOne"];
    expect(diffItems(before, after).sort()).toEqual(
      ["Hard Inquiry XYZ", "Midland Collection"].sort(),
    );
  });

  it("handles empty before (no wins)", () => {
    expect(diffItems([], ["Something"])).toEqual([]);
  });

  it("handles empty after (everything is a win)", () => {
    expect(diffItems(["A", "B"], [])).toEqual(["A", "B"]);
  });

  it("does not treat added after-only items as wins", () => {
    expect(diffItems(["Same"], ["Same", "New Collection"])).toEqual([]);
  });
});

describe("extractUtilization — edge cases", () => {
  it("parses limit/balance/pct lines", () => {
    const text = "Chase Freedom  $5000  $2500  50%";
    const rows = extractUtilization(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].pctUsed).toBe(50);
    expect(rows[0].payTo30).toBeGreaterThan(0);
  });

  it("skips invalid pct > 100", () => {
    const text = "Bad Card $1000 $2000 150%";
    expect(extractUtilization(text)).toEqual([]);
  });

  it("caps at 12 rows", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `Card${i} $1000 $${100 + i} 20%`,
    ).join("\n");
    expect(extractUtilization(lines).length).toBeLessThanOrEqual(12);
  });
});

describe("extractPositiveAccounts", () => {
  it("finds paid as agreed / current language", () => {
    const text = "Account paid as agreed\nNever late on mortgage\nSomething else";
    const pos = extractPositiveAccounts(text);
    expect(pos.length).toBeGreaterThan(0);
  });
});

// ── Confidence / file strength ───────────────────────────────────────────────

describe("buildConfidence / computeFileStrengthScore — edges", () => {
  it("all bureaus present → high confidence", () => {
    const c = buildConfidence(
      { transunion: 600, experian: 610, equifax: 620 },
      { transunion: 630, experian: 640, equifax: 650 },
    );
    expect(c.transunion).toBe(0.9);
    expect(c.experian).toBe(0.9);
    expect(c.equifax).toBe(0.9);
  });

  it("clamps file strength 0–100", () => {
    expect(computeFileStrengthScore(850, 20, 0)).toBeLessThanOrEqual(100);
    expect(computeFileStrengthScore(300, 0, 50)).toBeGreaterThanOrEqual(0);
  });

  it("null afterMiddle still returns a number", () => {
    const n = computeFileStrengthScore(null, 2, 2);
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(100);
  });
});

// ── Compliance hard vs soft ──────────────────────────────────────────────────

describe("validateReportCompliance — hard vs soft matrix", () => {
  it("hard-blocks missing CROA", () => {
    const data = sampleData({ croaDisclosure: "No legal text" });
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/CROA/);
  });

  it("hard-blocks empty client name", () => {
    const data = sampleData({ client: { firstName: "  " } });
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/first name/i);
  });

  it("hard-blocks invalid roadmap round", () => {
    const data = sampleData();
    data.roadmap.currentRound = 0;
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/Invalid round/);
  });

  it("hard-blocks out-of-range bureau scores", () => {
    const data = sampleData();
    data.bureauScores.experian.after = 900;
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/out of range/);
  });

  it("soft-warns Equifax drop >150 (Alex Gomez style)", () => {
    const data = sampleData({
      bureauScores: {
        transunion: { before: 603, after: 551 },
        experian: { before: 632, after: 549 },
        equifax: { before: 747, after: 552 },
      },
      middleScore: { before: 632, after: 551 },
    });
    const result = validateReportCompliance(data);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => /equifax/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /150/i.test(w))).toBe(true);
  });

  it("exact 150-point drop is NOT a warning (threshold is exclusive)", () => {
    const data = sampleData();
    data.bureauScores.equifax = { before: 700, after: 550 };
    const result = validateReportCompliance(data);
    expect(result.warnings.filter((w) => /equifax/i.test(w))).toHaveLength(0);
  });

  it("151-point drop IS a warning", () => {
    const data = sampleData();
    data.bureauScores.equifax = { before: 701, after: 550 };
    expect(
      validateReportCompliance(data).warnings.some((w) => /equifax/i.test(w)),
    ).toBe(true);
  });

  it("score improvements never warn for drop rule", () => {
    const data = sampleData({
      bureauScores: {
        transunion: { before: 500, after: 700 },
        experian: { before: 510, after: 710 },
        equifax: { before: 520, after: 720 },
      },
      middleScore: { before: 510, after: 710 },
    });
    expect(
      validateReportCompliance(data).warnings.filter((w) => /dropped/i.test(w)),
    ).toHaveLength(0);
  });

  it("blocks multiple prohibited phrases", () => {
    const data = sampleData();
    data.actionPlan[0].description = "We guaranteed results and will increase 50 points";
    data.fundingReadinessNote = "Send a goodwill letter to negotiate debt";
    const errors = validateReportCompliance(data).errors.join(" ");
    expect(errors).toMatch(/Compliance issue/);
  });

  it("accepts valid IH-N tradeline codes", () => {
    const data = sampleData();
    data.tradelineRecommendation = {
      code: "IH-2",
      projectedImpact: "Projected +10 points when reporting updates",
    };
    expect(validateReportCompliance(data).errors).toHaveLength(0);
  });

  it("rejects lowercase-only invalid codes", () => {
    const data = sampleData();
    data.tradelineRecommendation = {
      code: "ih",
      projectedImpact: "Projected improvement",
    };
    expect(validateReportCompliance(data).errors.join(" ")).toMatch(/IH-N/);
  });

  it("warns when middle score drifts from bureau median", () => {
    const data = sampleData({
      middleScore: { before: 500, after: 800 },
    });
    expect(validateReportCompliance(data).warnings.length).toBeGreaterThan(0);
  });

  it("zero before scores skip drop warning", () => {
    const data = sampleData();
    data.bureauScores.equifax = { before: 0, after: 552 };
    expect(
      validateReportCompliance(data).warnings.filter((w) => /equifax/i.test(w)),
    ).toHaveLength(0);
  });
});

describe("scoresRoughlyMatchMiddle — boundary", () => {
  it("allows drift of exactly 5 points", () => {
    const issues = scoresRoughlyMatchMiddle({
      middleScore: { before: 615, after: 715 },
      bureauScores: {
        transunion: { before: 600, after: 700 },
        experian: { before: 610, after: 710 },
        equifax: { before: 620, after: 720 },
      },
    });
    // median before=610, after=710; drift 5 → not > 5
    expect(issues).toHaveLength(0);
  });

  it("flags drift of 6 points", () => {
    const issues = scoresRoughlyMatchMiddle({
      middleScore: { before: 616, after: 710 },
      bureauScores: {
        transunion: { before: 600, after: 700 },
        experian: { before: 610, after: 710 },
        equifax: { before: 620, after: 720 },
      },
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});

// ── End-to-end join scenario (text-level, no PDF I/O) ─────────────────────────

describe("join scenario — before/after credit reports", () => {
  const beforeText = `
    SmartCredit Report — Enrollment
    TransUnion Score: 603
    Experian Score: 632
    Equifax Score: 610
    MIDLAND FUNDING Collection account $1200
    PORTFOLIO RECOVERY charge-off
    Late payment Verizon
  `;

  const afterText = `
    SmartCredit Report — Current
    TransUnion Score: 640
    Experian Score: 655
    Equifax Score: 648
    Late payment Verizon
  `;

  it("detects provider, extracts scores, diffs wins", () => {
    expect(detectProvider(beforeText)).toBe("smartcredit");
    const before = extractAllScores(beforeText);
    const after = extractAllScores(afterText);
    expect(before.transunion).toBe(603);
    expect(after.transunion).toBe(640);
    expect(middleScore(after)!).toBeGreaterThan(middleScore(before)!);

    const wins = diffItems(
      detectNegativeLines(beforeText),
      detectNegativeLines(afterText),
    );
    expect(wins.some((w) => /midland/i.test(w))).toBe(true);
    expect(wins.some((w) => /portfolio/i.test(w))).toBe(true);
    expect(wins.every((w) => !/verizon/i.test(w))).toBe(true);
  });

  it("builds compliant report payload from join", () => {
    const before = extractAllScores(beforeText);
    const after = extractAllScores(afterText);
    const data = sampleData({
      bureauScores: {
        transunion: {
          before: before.transunion ?? 0,
          after: after.transunion ?? 0,
        },
        experian: {
          before: before.experian ?? 0,
          after: after.experian ?? 0,
        },
        equifax: {
          before: before.equifax ?? 0,
          after: after.equifax ?? 0,
        },
      },
      middleScore: {
        before: middleScore(before) ?? 0,
        after: middleScore(after) ?? 0,
      },
      wins: diffItems(
        detectNegativeLines(beforeText),
        detectNegativeLines(afterText),
      ).map((itemRemoved) => ({
        itemRemoved,
        bureaus: ["TU"] as ("TU" | "EX" | "EQ")[],
        impact: "Removed from report",
        status: "Removed",
      })),
    });
    const result = validateReportCompliance(data);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.filter((w) => /dropped/i.test(w))).toHaveLength(0);
  });

  it("flags swapped PDFs (after worse than before) as soft warnings when drop >150", () => {
    // Simulate uploading enrollment as "after" and a damaged file as "before"
    const swappedBefore = extractAllScores(afterText);
    const swappedAfter = extractAllScores(`
      Equifax Score: 400
      TransUnion Score: 410
      Experian Score: 420
    `);
    const data = sampleData({
      bureauScores: {
        transunion: {
          before: swappedBefore.transunion ?? 0,
          after: swappedAfter.transunion ?? 0,
        },
        experian: {
          before: swappedBefore.experian ?? 0,
          after: swappedAfter.experian ?? 0,
        },
        equifax: {
          before: swappedBefore.equifax ?? 0,
          after: swappedAfter.equifax ?? 0,
        },
      },
      middleScore: {
        before: middleScore(swappedBefore) ?? 0,
        after: middleScore(swappedAfter) ?? 0,
      },
    });
    const result = validateReportCompliance(data);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("provider detection — aliases", () => {
  it.each([
    ["Identity IQ portal", "identityiq"],
    ["IDENTITYIQ", "identityiq"],
    ["smart credit app", "smartcredit"],
    ["My Score IQ", "myscoreiq"],
    ["random bureau dump", "generic"],
  ] as const)("%s → %s", (text, provider) => {
    expect(detectProvider(text)).toBe(provider);
  });
});

describe("toPdfSafeText — WinAnsi safety", () => {
  it("replaces unicode arrow that crashed pdf-lib", () => {
    expect(toPdfSafeText("632 → 551")).toBe("632 -> 551");
    expect(toPdfSafeText("Middle Score: 700 → 720")).toBe(
      "Middle Score: 700 -> 720",
    );
  });

  it("replaces em/en dashes and bullets", () => {
    expect(toPdfSafeText("Progress — Alex")).toBe("Progress - Alex");
    expect(toPdfSafeText("15–25 points")).toBe("15-25 points");
    expect(toPdfSafeText("• Milestone")).toBe("* Milestone");
  });

  it("keeps latin-1 accents used in Spanish labels", () => {
    expect(toPdfSafeText("Utilización")).toBe("Utilización");
    expect(toPdfSafeText("Crédito")).toBe("Crédito");
  });

  it("strips unsupported symbols", () => {
    expect(toPdfSafeText("Score ✅ done")).toMatch(/Score \? done|Score \?done/);
  });
});
