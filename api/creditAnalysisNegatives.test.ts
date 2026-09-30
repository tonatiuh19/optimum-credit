import { describe, expect, it } from "vitest";
import {
  isJunkNegativeAccountName,
  isNonTradelineNegativeNoise,
} from "./index";

describe("isJunkNegativeAccountName", () => {
  it("rejects PDF field labels mistaken for creditors", () => {
    expect(isJunkNegativeAccountName("Payment Status:")).toBe(true);
    expect(isJunkNegativeAccountName("Comments:")).toBe(true);
    expect(isJunkNegativeAccountName("Account Type:")).toBe(true);
    expect(isJunkNegativeAccountName("Date Opened")).toBe(true);
  });

  it("accepts real creditor names", () => {
    expect(isJunkNegativeAccountName("CAPITAL ONE")).toBe(false);
    expect(isJunkNegativeAccountName("MIDLAND CREDIT")).toBe(false);
    expect(isJunkNegativeAccountName("Late Payment")).toBe(false);
  });
});

describe("isNonTradelineNegativeNoise", () => {
  it("rejects score-factor bullets and summary stats", () => {
    expect(isNonTradelineNegativeNoise("Too many accounts with balances")).toBe(
      true,
    );
    expect(isNonTradelineNegativeNoise("Collection: 1 0 0")).toBe(true);
    expect(isNonTradelineNegativeNoise("Total Accounts: 19")).toBe(true);
  });

  it("accepts tradeline-looking rows", () => {
    expect(
      isNonTradelineNegativeNoise("PORTFOLIO RECOVERY - Collection"),
    ).toBe(false);
  });
});
