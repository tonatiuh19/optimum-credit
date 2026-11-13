/**
 * Nov 12, 2026 audit: SmartCredit prints the bureau under each inquiry as "TransUnion®" / "Experian®" /
 * "Equifax®". The text reader matched exact names only, so it read ZERO inquiries from those PDFs and the
 * printed-inquiries repair never ran (held reports: "13 inquiries read, summary 14"). No client data here.
 */
import { describe, expect, it } from "vitest";
import { parseSmartCredit } from "./creditFile";

const report = (rows: Array<[string, string, string]>) =>
  [
    "Inquiries 3",
    "Inquiries are requests for your credit history.",
    "These inquiries have matching accounts on your report.",
    ...rows.flat(),
    "Creditor Contacts",
  ].join("\n");

describe("SmartCredit printed inquiries", () => {
  it("reads bureaus printed with the ® sign (the bug: 0 read)", () => {
    const f = parseSmartCredit(report([["4/30/2025", "AUTO LENDER", "TransUnion®"], ["3/24/2025", "CARD BANK", "Experian®"], ["1/23/2024", "OTHER BANK", "Equifax®"]]));
    expect(f.inquiries.map((q) => `${q.date} ${q.creditor} ${q.bureau}`)).toEqual([
      "4/30/2025 AUTO LENDER TU",
      "3/24/2025 CARD BANK EX",
      "1/23/2024 OTHER BANK EQ",
    ]);
  });

  it("still reads the plain names, and keeps two pulls by the same lender on the same day", () => {
    const f = parseSmartCredit(report([["4/30/2025", "AUTO LENDER", "TransUnion"], ["4/30/2025", "AUTO LENDER", "TransUnion"]]));
    expect(f.inquiries).toHaveLength(2);
  });

  it("reads the newer month-name dates", () => {
    const f = parseSmartCredit(report([["Jun 01, 2026", "MORTGAGE CO", "Equifax®"]]));
    expect(f.inquiries).toMatchObject([{ date: "Jun 01, 2026", creditor: "MORTGAGE CO", bureau: "EQ" }]);
  });

  it("ignores rows whose third line is not a bureau", () => {
    const f = parseSmartCredit(report([["4/30/2025", "AUTO LENDER", "Transportation"], ["4/30/2025", "AUTO LENDER", "TransUnion® Extra"]]));
    expect(f.inquiries).toHaveLength(0);
  });
});

describe("inquiries when a report is read in parts", () => {
  it("two same-day pulls by one lender in one part are both kept; a copy repeated on the shared page is dropped", async () => {
    const { mergeCreditFileParts } = await import("./creditFileExtract");
    const q = (date: string, creditor: string) => ({ date, creditor, bureau: "TU" as const, matchedAccount: null });
    const part = (inquiries: ReturnType<typeof q>[]) =>
      ({ provider: "smartcredit", reportDate: "05/01/2025", scores: { TU: 600, EX: 600, EQ: 600 }, accounts: [], inquiries }) as any;
    const merged = mergeCreditFileParts([
      { file: part([q("4/30/2025", "AUTO LENDER"), q("4/30/2025", "AUTO LENDER"), q("3/1/2025", "CARD BANK")]), firstPage: 0 },
      { file: part([q("3/1/2025", "CARD BANK"), q("2/1/2025", "OTHER")]), firstPage: 5 },
    ]);
    expect(merged.inquiries.map((x: any) => `${x.date} ${x.creditor}`)).toEqual([
      "4/30/2025 AUTO LENDER",
      "4/30/2025 AUTO LENDER",
      "3/1/2025 CARD BANK",
      "2/1/2025 OTHER",
    ]);
  });
});
