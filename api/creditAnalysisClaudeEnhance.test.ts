import { afterEach, describe, expect, it } from "vitest";
import {
  mergeCreditAnalysisClaudeEnhancement,
  parseCreditAnalysisClaudeJson,
  actionPlanRowsFromAnalyst,
} from "./creditAnalysisClaudeEnhance";
import {
  runClaudeCreditAnalysisEnhance,
  runCreditAnalysisAlgorithm,
  type CreditAnalysisAnalystFlat,
} from "./index";

function baseAnalyst(): CreditAnalysisAnalystFlat {
  return runCreditAnalysisAlgorithm({
    clientName: "Ruth Flores",
    firstName: "Ruth",
    lastName: "Smith",
    language: "en",
    clientGoal: "General Improvement",
    scores: { transunion: 541, experian: 568, equifax: 552 },
    negatives: [
      {
        type: "Collection",
        creditor: "MIDLAND FUNDING",
        detail: "Collection $450",
        bureaus: ["TU"],
      },
    ],
    reportText:
      "TransUnion Experian Equifax\n541 568 552\nCHASE CARD 5000 1000 20%",
  });
}

describe("mergeCreditAnalysisClaudeEnhancement", () => {
  it("upgrades narrative but never touches scores or util numbers", () => {
    const base = baseAnalyst();
    const merged = mergeCreditAnalysisClaudeEnhancement(base, {
      fha_status:
        "Projected path: General Credit Health remains POOR until Round 2 collections clear.",
      action_plan: [
        {
          time: "Round 1",
          action: "File inquiry + personal-info audit",
          reason: "FCRA §604 / §611",
        },
        {
          time: "Round 2",
          action: "Dispute MIDLAND FUNDING collection",
          reason: "FDCPA §809",
        },
      ],
      neg_dispute_basis: [
        {
          account: "MIDLAND FUNDING",
          dispute_basis:
            "Third-party collection — request validation (FDCPA §809) and dispute accuracy (FCRA §611).",
        },
      ],
      client_text_message:
        "Hi Ruth, your Optimum analysis is ready. Review Round 1–2 priorities: optimum-financial-group.com",
    });

    expect(merged.score_transunion).toBe(541);
    expect(merged.score_experian).toBe(568);
    expect(merged.score_equifax).toBe(552);
    expect(merged.action_1_time).toBe("Round 1");
    expect(merged.action_2_time).toBe("Round 2");
    expect(String(merged.neg_1_dispute_basis)).toMatch(/FDCPA/);
  });

  it("ignores empty / null drafts", () => {
    const base = baseAnalyst();
    expect(mergeCreditAnalysisClaudeEnhancement(base, null)).toEqual(base);
    expect(mergeCreditAnalysisClaudeEnhancement(base, {})).toEqual(base);
  });

  it("sanitizes illegal calendar timing in action_plan to Round labels", () => {
    const base = baseAnalyst();
    const merged = mergeCreditAnalysisClaudeEnhancement(base, {
      action_plan: [
        { time: "in 30 days", action: "File disputes", reason: "Impact" },
        { time: "Month 2", action: "Follow up", reason: "Replies" },
      ],
    });
    expect(merged.action_1_time).toMatch(/^Round 1$/);
    expect(merged.action_2_time).toMatch(/^Round 1$/);
  });
});

describe("parseCreditAnalysisClaudeJson", () => {
  it("parses fenced JSON object", () => {
    const draft = parseCreditAnalysisClaudeJson(
      'Here you go:\n```json\n{"fha_status":"OK"}\n```',
    );
    expect(draft?.fha_status).toBe("OK");
  });
});

describe("actionPlanRowsFromAnalyst", () => {
  it("reads flat action slots", () => {
    const rows = actionPlanRowsFromAnalyst(baseAnalyst());
    expect(rows[0].time).toMatch(/Round/i);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("runClaudeCreditAnalysisEnhance mock", () => {
  afterEach(() => {
    delete process.env.CREDIT_ANALYSIS_CLAUDE_MOCK_JSON;
  });

  it("enhances via CREDIT_ANALYSIS_CLAUDE_MOCK_JSON without calling Anthropic", async () => {
    process.env.CREDIT_ANALYSIS_CLAUDE_MOCK_JSON = JSON.stringify({
      fha_status: "Mock Claude lending status",
      client_text_message: "Mock SMS from Claude enhance",
    });
    const base = baseAnalyst();
    const out = await runClaudeCreditAnalysisEnhance({ analyst: base });
    expect(out.enhanced).toBe(true);
    expect(out.analyst.fha_status).toBe("Mock Claude lending status");
    expect(out.analyst.client_text_message).toBe("Mock SMS from Claude enhance");
    expect(out.analyst.score_transunion).toBe(base.score_transunion);
  });

  it("skips when no mock under Vitest", async () => {
    const out = await runClaudeCreditAnalysisEnhance({
      analyst: baseAnalyst(),
    });
    expect(out.enhanced).toBe(false);
    expect(out.error).toBe("vitest_skip");
  });
});
