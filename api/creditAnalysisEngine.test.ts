import { describe, expect, it } from "vitest";
import {
  assignDisputeRound,
  classifyProgramTier,
  estimateDisputeScoreLift,
  filterRevolvingUtilization,
  flagDuplicateInquiryPairs,
  looksLikeTradelineNegative,
  parseDerogatoryDateHint,
  projectScoresFromDisputes,
  sortNegativesForDisputePlan,
  type EngineRankedNeg,
} from "./creditAnalysisEngine";

describe("assignDisputeRound", () => {
  it("maps inquiries → Round 1", () => {
    expect(assignDisputeRound({ type: "Hard Inquiry", creditor: "AUTO FINANCE" })).toBe(
      1,
    );
  });

  it("maps collections → Round 2", () => {
    expect(
      assignDisputeRound({
        type: "Collection",
        creditor: "MIDLAND FUNDING",
        detail: "placed for collection",
      }),
    ).toBe(2);
  });

  it("maps bureau-incomplete charge-off → Round 3", () => {
    expect(
      assignDisputeRound(
        {
          type: "Charge-Off",
          creditor: "CAPITAL ONE",
          bureaus: ["TU"],
        },
        { triBureau: true },
      ),
    ).toBe(3);
  });

  it("maps consistent charge-off → Round 4", () => {
    expect(
      assignDisputeRound(
        {
          type: "Charge-Off",
          creditor: "CAPITAL ONE",
          bureaus: ["TU", "EX", "EQ"],
        },
        { triBureau: true },
      ),
    ).toBe(4);
  });
});

describe("classifyProgramTier", () => {
  it("Standard for ordinary collections/lates", () => {
    expect(
      classifyProgramTier([
        { type: "Collection", creditor: "ABC" },
        { type: "Charge-Off", creditor: "XYZ" },
      ]),
    ).toBe("standard");
  });

  it("Complex for bankruptcy / medical / student / repo", () => {
    expect(
      classifyProgramTier([{ type: "Bankruptcy", detail: "Chapter 7" }]),
    ).toBe("complex");
    expect(
      classifyProgramTier([{ type: "Collection", detail: "Medical hospital" }]),
    ).toBe("complex");
    expect(
      classifyProgramTier([], "Student loan Navient 90 days late"),
    ).toBe("complex");
  });
});

describe("projectScoresFromDisputes", () => {
  it("does not invent a steep climb when there are no negatives", () => {
    const p = projectScoresFromDisputes({
      today: 620,
      goalScore: 670,
      ranked: [],
    });
    expect(p.score_30).toBe(620);
    expect(p.score_90).toBeLessThanOrEqual(630);
  });

  it("scales with dispute lifts across rounds", () => {
    const ranked: EngineRankedNeg[] = [
      {
        account: "IQ",
        type: "Hard Inquiry",
        bureaus: "TU/EX",
        bureau_count: 2,
        priority: "LOWER",
        dispute_basis: "x",
        dispute_round: 1,
        derogatory_date: null,
        score_lift: 8,
      },
      {
        account: "MIDLAND",
        type: "Collection",
        bureaus: "TU",
        bureau_count: 1,
        priority: "HIGH",
        dispute_basis: "x",
        dispute_round: 2,
        derogatory_date: "2020-01-01",
        score_lift: 28,
      },
    ];
    const p = projectScoresFromDisputes({
      today: 540,
      goalScore: 670,
      ranked,
    });
    expect(p.score_30!).toBeGreaterThan(540);
    expect(p.score_60!).toBeGreaterThan(p.score_30!);
    expect(p.score_90!).toBeGreaterThanOrEqual(p.score_60!);
  });
});

describe("filterRevolvingUtilization", () => {
  it("drops installment and zero-limit rows", () => {
    const rows = filterRevolvingUtilization([
      {
        account: "CHASE CARD",
        limit: 5000,
        balance: 1000,
        pctUsed: 20,
        payTo30: 0,
        payTo10: 500,
      },
      {
        account: "Toyota Auto Loan",
        limit: 20000,
        balance: 15000,
        pctUsed: 75,
        payTo30: 0,
        payTo10: 0,
      },
      {
        account: "DEAD CARD",
        limit: 0,
        balance: 0,
        pctUsed: 0,
        payTo30: 0,
        payTo10: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].account).toBe("CHASE CARD");
  });
});

describe("looksLikeTradelineNegative", () => {
  it("accepts creditor + collection", () => {
    expect(looksLikeTradelineNegative("MIDLAND FUNDING - Collection $450")).toBe(
      true,
    );
  });

  it("rejects risk-factor and summary noise", () => {
    expect(looksLikeTradelineNegative("Too many inquiries for credit")).toBe(
      false,
    );
    expect(looksLikeTradelineNegative("Collection: 1 0 0")).toBe(false);
  });
});

describe("sortNegativesForDisputePlan", () => {
  it("orders by round then oldest derogatory date", () => {
    const sorted = sortNegativesForDisputePlan([
      {
        account: "NEW COLL",
        type: "Collection",
        bureaus: "TU",
        bureau_count: 1,
        priority: "HIGH",
        dispute_basis: "",
        dispute_round: 2,
        derogatory_date: "2022-06-01",
        score_lift: 20,
      },
      {
        account: "INQ",
        type: "Hard Inquiry",
        bureaus: "EX",
        bureau_count: 1,
        priority: "LOWER",
        dispute_basis: "",
        dispute_round: 1,
        derogatory_date: null,
        score_lift: 8,
      },
      {
        account: "OLD COLL",
        type: "Collection",
        bureaus: "EQ",
        bureau_count: 1,
        priority: "HIGH",
        dispute_basis: "",
        dispute_round: 2,
        derogatory_date: "2019-01-01",
        score_lift: 20,
      },
    ]);
    expect(sorted.map((s) => s.account)).toEqual([
      "INQ",
      "OLD COLL",
      "NEW COLL",
    ]);
  });
});

describe("parseDerogatoryDateHint / flagDuplicateInquiryPairs", () => {
  it("parses US dates", () => {
    expect(parseDerogatoryDateHint("Collection opened 03/15/2019")).toBe(
      "2019-03-15",
    );
  });

  it("flags same-creditor inquiries within a week", () => {
    const set = flagDuplicateInquiryPairs([
      { creditor: "Capital One", date: "2024-01-02" },
      { creditor: "Capital One", date: "2024-01-05" },
      { creditor: "Other Bank", date: "2024-06-01" },
    ]);
    expect(set.has("Capital One")).toBe(true);
    expect(set.has("Other Bank")).toBe(false);
  });
});

describe("estimateDisputeScoreLift", () => {
  it("ranks charge-off above inquiry", () => {
    expect(
      estimateDisputeScoreLift({ type: "Charge-Off", creditor: "X" }),
    ).toBeGreaterThan(
      estimateDisputeScoreLift({ type: "Hard Inquiry", creditor: "Y" }),
    );
  });
});
