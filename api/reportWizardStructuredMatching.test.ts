/**
 * Structured account matching + report-date parsing for OFG Progress Report Wizard
 * (Phases C–D helpers).
 */
import { describe, expect, it } from "vitest";
import {
  detectBureausInText,
  diffNegativeAccounts,
  extractNegativeAccounts,
  extractReportDate,
  mergeRemovedWins,
  normalizeAccountKey,
  parseLooseDateToIso,
  type NegativeAccount,
} from "./index";

describe("normalizeAccountKey", () => {
  it("normalizes creditor + type into a stable fingerprint", () => {
    expect(normalizeAccountKey("Midland Funding", "Collection")).toBe(
      normalizeAccountKey("midland funding LLC", "collection"),
    );
  });
});

describe("detectBureausInText", () => {
  it("finds TU/EX/EQ from full names", () => {
    expect(
      detectBureausInText("TransUnion Experian Equifax"),
    ).toEqual(["TU", "EX", "EQ"]);
  });

  it("finds short codes", () => {
    expect(detectBureausInText("Removed on TU and EQ only")).toEqual([
      "TU",
      "EQ",
    ]);
  });
});

describe("extractNegativeAccounts", () => {
  it("builds structured accounts with types", () => {
    const text = `
Acme Collections - Collection account past due
Capital One charge-off balance $1200
Some other noise line without keywords
`;
    const accounts = extractNegativeAccounts(text);
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    expect(accounts.some((a) => /collection/i.test(a.type))).toBe(true);
    expect(accounts.some((a) => /charge/i.test(a.type))).toBe(true);
  });

  it("tags bureaus from neighboring lines when present", () => {
    const text = `
Midland Funding collection
Status: TransUnion Experian
`;
    const accounts = extractNegativeAccounts(text);
    const midland = accounts.find((a) => /midland/i.test(a.label));
    expect(midland).toBeTruthy();
    expect(midland!.bureaus).toEqual(
      expect.arrayContaining(["TU", "EX"]),
    );
  });
});

describe("diffNegativeAccounts", () => {
  const before: NegativeAccount[] = [
    {
      key: normalizeAccountKey("Midland", "Collection"),
      label: "Midland — Collection",
      type: "Collection",
      bureaus: ["TU", "EX", "EQ"],
    },
    {
      key: normalizeAccountKey("Midland", "Charge-Off"),
      label: "Midland — Charge-Off",
      type: "Charge-Off",
      bureaus: ["EX"],
    },
    {
      key: normalizeAccountKey("Capital One", "Charge-Off"),
      label: "Capital One — Charge-Off",
      type: "Charge-Off",
      bureaus: ["EX"],
    },
  ];
  const after: NegativeAccount[] = [
    {
      key: normalizeAccountKey("Midland", "Collection"),
      label: "Midland — Collection",
      type: "Collection",
      bureaus: ["TU", "EX", "EQ"],
    },
    {
      key: normalizeAccountKey("Capital One", "Charge-Off"),
      label: "Capital One — Charge-Off",
      type: "Charge-Off",
      bureaus: ["EX"],
    },
  ];

  it("marks removed accounts as wins (exact key only)", () => {
    const { removed, remaining } = diffNegativeAccounts(before, after);
    expect(removed).toHaveLength(1);
    expect(removed[0].label).toMatch(/Charge-Off/i);
    expect(remaining).toHaveLength(2);
  });

  it("does not collapse same-creditor different types", () => {
    const { removed } = diffNegativeAccounts(before, after);
    expect(removed.every((r) => /Charge-Off/i.test(r.label))).toBe(true);
    expect(removed.some((r) => /Collection/i.test(r.label))).toBe(false);
  });
});

describe("mergeRemovedWins", () => {
  it("merges line-diff removals not covered by structured results", () => {
    const structured = [
      {
        key: normalizeAccountKey("Midland", "Collection"),
        label: "Midland — Collection",
        type: "Collection",
        bureaus: ["TU"] as ("TU" | "EX" | "EQ")[],
      },
    ];
    const merged = mergeRemovedWins(structured, [
      "Midland Funding collection",
      "Acme Judgment lien",
    ]);
    expect(merged.some((m) => /Midland/i.test(m.label))).toBe(true);
    expect(merged.some((m) => /Acme/i.test(m.label))).toBe(true);
  });
});

describe("extractReportDate / parseLooseDateToIso", () => {
  it("parses MM/DD/YYYY report date lines", () => {
    expect(parseLooseDateToIso("03/15/2026")).toBe("2026-03-15");
    expect(
      extractReportDate("Report Date: 03/15/2026\nTransUnion score 620"),
    ).toBe("2026-03-15");
  });

  it("parses unambiguous DD/MM when day > 12", () => {
    expect(parseLooseDateToIso("15/03/2026")).toBe("2026-03-15");
  });

  it("parses As of dates", () => {
    expect(extractReportDate("As of: 2026-04-01 Equifax")).toBe("2026-04-01");
  });

  it("returns null when no date present", () => {
    expect(extractReportDate("No date here, just scores TU 600")).toBeNull();
  });

  it("parses SmartCredit triplicated Credit Report Date row", () => {
    expect(
      extractReportDate(
        `Credit Report Date\nConsumer Statement\n05/22/2026 \t05/22/2026 \t05/22/2026\n`,
      ),
    ).toBe("2026-05-22");
  });
});
