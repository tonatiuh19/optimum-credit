import { describe, expect, it } from "vitest";
import {
  isJunkNegativeAccountName,
  isNonTradelineNegativeNoise,
  extractNegativeAccounts,
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

describe("report field rows are not tradelines (Huiza CR-3036985)", () => {
  it("drops table-of-contents headings, field rows and payment-status values", () => {
    for (const line of [
      "10. Collections 52",
      "4.11 Possible Financial I (CLOSED) 42",
      "30 Days Past Due 0 0 0",
      "120 Days Past Due N/A 0 N/A",
      "Included in Bankruptcy 0 0 0",
      "Amount Past Due $0 $0 $0",
      "CURRENT ACCOUNT/WAS 30 DAYS PAST DUE DATE TWO",
    ]) {
      expect(isNonTradelineNegativeNoise(line)).toBe(true);
    }
  });

  it("keeps real creditors, including ones starting with digits", () => {
    expect(
      isNonTradelineNegativeNoise("PORTFOLIO RECOVERY - Collection $512"),
    ).toBe(false);
    expect(isNonTradelineNegativeNoise("21ST MORTGAGE - Late Payment")).toBe(
      false,
    );
  });

  it("extracts no accounts from a clean report's summary rows", () => {
    const text = [
      "TransUnion Experian Equifax",
      "10. Collections 52",
      "30 Days Past Due 0 0 0",
      "60 Days Past Due 0 0 0",
      "Included in Bankruptcy 0 0 0",
      "Amount Past Due $0 $0 $0",
      "CURRENT ACCOUNT/WAS 30 DAYS PAST DUE DATE TWO",
    ].join("\n");
    expect(extractNegativeAccounts(text)).toEqual([]);
  });

  it("names status rows after the numbered tradeline heading", () => {
    const text = [
      "TransUnion Experian Equifax",
      "4.7 Kashable Llc",
      "30 Days Past Due 1 2 1",
      "Account Status Over 120 Days Past Due Over 120 Days Past Due Over 120 Days Past Due",
      "Status Over 120 Days Past Due Over 120 Days Past Due Over 120 Days Past Due",
    ].join("\n");
    expect(extractNegativeAccounts(text).map((a) => a.label)).toEqual([
      "Kashable Llc — Late Payment",
    ]);
  });
});
