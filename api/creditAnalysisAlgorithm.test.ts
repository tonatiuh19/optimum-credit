import { describe, expect, it } from "vitest";
import {
  runCreditAnalysisAlgorithm,
  computeMiddleScore,
  scoreBandLabel,
  classifyGoalKind,
  rankNegativeItem,
  resolveTextLanguage,
  buildAnalystAnalysisHtml,
} from "./index";

describe("score helpers", () => {
  it("labels FICO bands", () => {
    expect(scoreBandLabel(520)).toBe("POOR");
    expect(scoreBandLabel(620)).toBe("FAIR");
    expect(scoreBandLabel(700)).toBe("GOOD");
    expect(scoreBandLabel(760)).toBe("VERY GOOD");
    expect(scoreBandLabel(810)).toBe("EXCELLENT");
    expect(scoreBandLabel(null)).toBe("");
  });

  it("uses lower of 2 scores when one bureau is null", () => {
    expect(
      computeMiddleScore({
        transunion: 700,
        experian: null,
        equifax: 640,
      }),
    ).toBe(640);
  });

  it("uses median of 3", () => {
    expect(
      computeMiddleScore({
        transunion: 600,
        experian: 720,
        equifax: 680,
      }),
    ).toBe(680);
  });
});

describe("classifyGoalKind", () => {
  it("detects each preset goal", () => {
    expect(classifyGoalKind("FHA Loan")).toBe("fha");
    expect(classifyGoalKind("Conventional Mortgage")).toBe("conventional");
    expect(classifyGoalKind("Jumbo Loan")).toBe("jumbo");
    expect(classifyGoalKind("Auto Financing")).toBe("auto");
    expect(classifyGoalKind("Business Funding")).toBe("business");
    expect(classifyGoalKind("General Improvement")).toBe("general");
  });
});

describe("rankNegativeItem", () => {
  it("prioritizes charge-off not on all 3 as CRITICAL", () => {
    const r = rankNegativeItem({
      type: "Charge-Off",
      creditor: "CAPITAL ONE",
      detail: "Charge-off TU only $1200",
      bureaus: ["TU"],
    });
    expect(r.priority).toBe("CRITICAL");
  });

  it("ranks inquiries LOWER", () => {
    expect(
      rankNegativeItem({ type: "Hard Inquiry", detail: "Inquiry from XYZ" })
        .priority,
    ).toBe("LOWER");
  });
});

describe("resolveTextLanguage", () => {
  it("uses Spanish for es form language", () => {
    expect(resolveTextLanguage("es", "Smith")).toBe("Spanish");
  });

  it("respects explicit English even for Hispanic surnames", () => {
    expect(resolveTextLanguage("en", "Garcia")).toBe("English");
    expect(resolveTextLanguage("en", "Flores")).toBe("English");
    expect(resolveTextLanguage("en", "Smith")).toBe("English");
  });
});

describe("runCreditAnalysisAlgorithm", () => {
  const base = {
    clientName: "Alex Rivera",
    firstName: "Alex",
    lastName: "Rivera",
    repName: "Jordan Lee",
    language: "en" as const,
    scores: { transunion: 640, experian: 655, equifax: 630 },
    negatives: [
      {
        type: "Collection",
        creditor: "ABC COLLECTIONS",
        detail: "Collection $800",
      },
      { type: "Hard Inquiry", creditor: "AUTO FINANCE", detail: "Inquiry" },
    ],
    reportText: `
      TransUnion 640 Experian 655 Equifax 630
      CHASE CARD 5000 2500 50%
      AMEX 10000 1000 10%
      credit card revolving installment auto loan
      account account account account account
      paid as agreed never late
    `,
    utilization: [
      {
        account: "CHASE CARD",
        limit: 5000,
        balance: 2500,
        pctUsed: 50,
        payTo30: 1000,
        payTo10: 1500,
      },
      {
        account: "AMEX",
        limit: 10000,
        balance: 1000,
        pctUsed: 10,
        payTo30: 0,
        payTo10: 0,
      },
    ],
  };

  it("returns flat FHA analysis with mortgage conversion + labels", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      clientGoal: "FHA Loan",
    });
    expect(a.text_language).toBe("English"); // explicit en wins over surname
    expect(a.score_tu_label).toBe("FAIR");
    expect(a.middle_score).toBe(640);
    expect(a.mortgage_tu).not.toBeNull();
    expect(a.mortgage_tu!).toBeLessThan(a.score_transunion!);
    expect(a.fha_status.toLowerCase()).toMatch(/fha|eligible/);
    expect(a.fs_label_1).toMatch(/Open Revolving|Revolving/i);
    expect(a.fs_label_3).toMatch(/Mortgage|Hipotecario/i);
    expect(a.neg_1_account).toMatch(/^IH-\d+$/);
    expect(a.util_1_account).toMatch(/^RU-\d+$/);
    expect(a.neg_1_priority).toMatch(/HIGH|CRITICAL|MEDIUM|LOWER/);
    expect(a.neg_1_round).toMatch(/^[1-4]$/);
    expect(a.action_1_time).toBeTruthy();
    expect(a.action_6_action).toBeTruthy();
    expect(a.negative_items_html).toContain("<tr>");
    expect(a.action_plan_html).toContain("#121829");
    expect(a.action_plan_html).toContain("#C0A06A");
    expect(a.client_text_message).toContain("optimum-financial-group.com");
    expect(a.client_text_message).toContain("Jordan Lee");
    expect(a.round_1_actions).toContain("★");
  });

  it("adapts auto financing labels and tier status", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      clientGoal: "Auto Financing",
    });
    expect(a.text_language).toBe("English");
    expect(a.fha_status).toMatch(/Auto Financing Tier/i);
    expect(a.fs_label_3).toMatch(/Auto Loan History/i);
    expect(a.target_timeframe).toMatch(/Auto lending/i);
  });

  it("sets next-tier goal for general improvement", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      clientGoal: "General Improvement",
    });
    expect(a.goal_score).toBe(670);
    expect(a.fha_status).toMatch(/General Credit Health: FAIR/);
    expect(a.fs_label_3).toMatch(/Account Diversity/i);
  });

  it("flags weak extraction honestly", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      weakExtraction: true,
    });
    expect(a.utilization_critical_note).toMatch(/Limited PDF|text-based/i);
  });

  it("uses Round 1–4 labels (no week/month timing)", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      clientGoal: "General Improvement",
    });
    expect(a.action_1_time).toMatch(/Round 1|Ronda 1/i);
    expect(a.action_6_time).toMatch(/Round 4|Ronda 4/i);
    expect(a.target_timeframe).toMatch(/Round/i);
    expect(a.action_1_time).not.toMatch(/WEEK|MONTH|SEMANA|MES/i);
  });

  it("assigns dispute rounds and program tier", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      clientGoal: "General Improvement",
      negatives: [
        {
          type: "Hard Inquiry",
          creditor: "AUTO FINANCE",
          detail: "Inquiry 01/02/2024",
          bureaus: ["TU", "EX"],
        },
        {
          type: "Collection",
          creditor: "MIDLAND FUNDING",
          detail: "Collection $800 03/15/2019",
          bureaus: ["EQ"],
        },
        {
          type: "Charge-Off",
          creditor: "CAPITAL ONE",
          detail: "Charged off",
          bureaus: ["TU", "EX", "EQ"],
        },
      ],
    });
    expect(a.program_tier).toBe("standard");
    expect(a.program_tier_label).toMatch(/Standard/i);
    expect(a.neg_1_round).toBe("1");
    expect(a.neg_2_round).toBe("2");
    expect(a.neg_3_round).toBe("4");
    expect(a.score_30_days).toBeGreaterThan(a.score_today as number);
  });

  it("flags Complex Repair for bankruptcy files", () => {
    const a = runCreditAnalysisAlgorithm({
      ...base,
      lastName: "Smith",
      negatives: [{ type: "Bankruptcy", creditor: "Chapter 7", detail: "BK" }],
    });
    expect(a.program_tier).toBe("complex");
  });
});

describe("buildAnalystAnalysisHtml", () => {
  it("never claims no negatives when weak", () => {
    const analyst = runCreditAnalysisAlgorithm({
      clientName: "Jamie Test",
      firstName: "Jamie",
      lastName: "Test",
      language: "en",
      clientGoal: "General Improvement",
      scores: { transunion: null, experian: null, equifax: null },
      negatives: [],
      reportText: "",
      weakExtraction: true,
    });
    const { html, text } = buildAnalystAnalysisHtml({
      firstName: "Jamie",
      analyst,
      weakExtraction: true,
      croaDisclosure: "CROA disclosure",
    });
    expect(html).not.toMatch(/no obvious negative/i);
    expect(html).toMatch(/Limited PDF|incomplete/i);
    expect(text).toMatch(/Limited PDF|incomplete/i);
  });
});
