import { describe, expect, it } from "vitest";
import {
  extractAllScores,
  extractNegativeAccounts,
  detectNegativeLines,
  isNonTradelineNegativeNoise,
  isJunkNegativeAccountName,
} from "./index";

describe("extractAllScores — identical-score bug (spec §0.1)", () => {
  it("maps distinct scores under a TransUnion/Experian/Equifax header row", () => {
    const text = `
      Credit Scores
      TransUnion Experian Equifax
      650 680 620
      Accounts
    `;
    const scores = extractAllScores(text);
    expect(scores.transunion).toBe(650);
    expect(scores.experian).toBe(680);
    expect(scores.equifax).toBe(620);
  });

  it("maps TU/EX/EQ abbreviated header columns", () => {
    const text = `
      TU EX EQ
      601 612 598
    `;
    const scores = extractAllScores(text, "generic");
    expect(scores.transunion).toBe(601);
    expect(scores.experian).toBe(612);
    expect(scores.equifax).toBe(598);
  });

  it("does not copy the first score into every bureau", () => {
    const text = `
      IdentityIQ Tri-Merge
      TransUnion Experian Equifax
      VantageScore 3.0
      541 568 552
    `;
    const scores = extractAllScores(text, "identityiq");
    expect(scores.transunion).toBe(541);
    expect(scores.experian).toBe(568);
    expect(scores.equifax).toBe(552);
    expect(new Set([scores.transunion, scores.experian, scores.equifax]).size).toBe(
      3,
    );
  });

  it("parses inline labeled scores without cross-bureau bleed", () => {
    const text = "TransUnion 640 Experian 655 Equifax 630";
    const scores = extractAllScores(text);
    expect(scores).toEqual({
      transunion: 640,
      experian: 655,
      equifax: 630,
    });
  });

  it("still parses one-label-per-line SmartCredit reports", () => {
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
});

describe("negative extraction — summary/narrative noise (spec §0.2)", () => {
  it("flags risk-factor and summary-stat phrases as non-accounts", () => {
    expect(isNonTradelineNegativeNoise("Too many inquiries for credit")).toBe(
      true,
    );
    expect(isNonTradelineNegativeNoise("You have too many accounts")).toBe(true);
    expect(isNonTradelineNegativeNoise("Lack of recent revolving credit")).toBe(
      true,
    );
    expect(isNonTradelineNegativeNoise("Total Accounts: 19")).toBe(true);
    expect(isNonTradelineNegativeNoise("Delinquent: 4 4 5")).toBe(true);
    expect(isNonTradelineNegativeNoise("Collection: 1 0 0")).toBe(true);
    expect(
      isNonTradelineNegativeNoise("Past Due: $0.00 $0.00 $0.00"),
    ).toBe(true);
    expect(isJunkNegativeAccountName("Payment Status:")).toBe(true);
  });

  it("keeps real creditor tradelines", () => {
    expect(isNonTradelineNegativeNoise("MIDLAND FUNDING - Collection")).toBe(
      false,
    );
    expect(isNonTradelineNegativeNoise("CAPITAL ONE charge-off")).toBe(false);
  });

  it("does not emit summary or score-factor rows as negatives", () => {
    const text = `
      Score Factors
      Too many inquiries for credit
      Lack of recent installment loans
      You have a serious delinquency
      Total Accounts: 19
      Delinquent: 4 4 5
      Collection: 1 0 0
      Past Due: $0.00 $0.00 $0.00
      MIDLAND FUNDING - Collection $450
      CAPITAL ONE charge-off balance 1200
      Payment Status: Collection
      Comments: charged off as bad debt
    `;
    const lines = detectNegativeLines(text);
    expect(lines.some((l) => /too many|lack of|you have|total accounts|delinquent:|collection: 1|past due: \$/i.test(l))).toBe(
      false,
    );
    expect(lines.some((l) => /midland/i.test(l))).toBe(true);
    expect(lines.some((l) => /capital one/i.test(l))).toBe(true);

    const accounts = extractNegativeAccounts(text);
    expect(
      accounts.every(
        (a) =>
          !/too many|lack of|you have|total accounts|payment status|comments/i.test(
            a.label,
          ),
      ),
    ).toBe(true);
    expect(accounts.some((a) => /midland/i.test(a.label))).toBe(true);
  });
});
