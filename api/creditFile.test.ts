import { describe, expect, it } from "vitest";
import { detectCreditFileProvider, parseCreditFile } from "./creditFile";
import {
  buildCreditFileExtractionParams,
  crossCheckCreditFile,
  parseCreditFileExtraction,
} from "./creditFileExtract";

/** Synthetic SmartCredit print-view text (layout copied, data invented). */
const T = "\t";
const LABELS = [
  "Account Number",
  "High Balance",
  "Date Opened",
  "Balance Owed",
  "Payment Status",
  "Creditor Remarks",
  "Credit Limit",
  "Payment History - Last 2 Years",
];
const FOOTER = [
  `10/10/26, 2:17 AM ${T}Ultra 4K 3B Report`,
  `https://member.smartcredit.com/reports/3b/print?orderId=x ${T}1/3`,
  "",
  "-- 1 of 3 --",
  "",
];
const SMARTCREDIT = [
  "Credit Scores",
  "Revolving Accounts",
  "TEST BANK CARD 411111****",
  "Open",
  "12% Credit Utilization",
  ...LABELS,
  "TransUnion®\t",
  "Experian®\t",
  "Equifax®",
  `611 ${T}603 ${T}585`,
  `09/22/2026 ${T}09/22/2026 ${T}09/22/2026`,
  `TransUnion 30: 0 60: 0 90: 0 ${T}Experian ${T}30: 0 60: 0 90: 0 ${T}Equifax ${T}30: 0 60: 0 90: 0`,
  // Header at the bottom of page 1, labels at the top of page 2.
  "SAMPLE COLLECTIONS LLC 98765****",
  "Negative Open In Dispute",
  ...FOOTER,
  ...LABELS,
  `TransUnion 30: 1 60: 1 90: 2 ${T}Experian ${T}30: –– 60: –– 90: –– ${T}Equifax ${T}30: 0 60: 0 90: 0`,
  "-- 2 of 3 --",
  // Page 3 printed as an image: only labels survive, header is lost.
  ...LABELS,
  `TransUnion 30: 0 60: 0 90: 0 ${T}Experian ${T}30: 0 60: 0 90: 0 ${T}Equifax ${T}30: 0 60: 0 90: 0`,
  "Public Records",
  "Below is an overview of your public records and can include details of bankruptcy.",
  "None Reported",
  "Inquiries 2",
  "The inquiries below have matching accounts on your credit report.",
  "8/17/2024",
  "TEST AUTO",
  "Experian",
  "The inquiries below were likely not approved since no matching account shows on your credit report.",
  "11/13/2025",
  "TEST BANK CARD",
  "TransUnion",
  "Creditor Contacts 2",
  "-- 3 of 3 --",
].join("\n");

describe("parseCreditFile (SmartCredit text skeleton)", () => {
  const cf = parseCreditFile(SMARTCREDIT);

  it("detects the provider, scores and report date", () => {
    expect(detectCreditFileProvider(SMARTCREDIT)).toBe("smartcredit");
    expect(cf.scores).toEqual({ TU: 611, EX: 603, EQ: 585 });
    expect(cf.reportDate).toBe("09/22/2026");
  });

  it("finds headers across page breaks and keeps image-page accounts as unreadable", () => {
    expect(cf.accounts.map((a) => a.creditor)).toEqual([
      "TEST BANK CARD",
      "SAMPLE COLLECTIONS LLC",
      "(unreadable — header on image page)",
    ]);
    expect(cf.accounts[1].headerStatus).toBe("Negative Open In Dispute");
    expect(cf.accounts[2].confident).toBe(false);
  });

  it("assigns days-late counts per account and bureau", () => {
    const tu = cf.accounts[1].bureaus.TU!;
    expect([tu.late30, tu.late60, tu.late90]).toEqual([1, 1, 2]);
    expect(cf.accounts[1].bureaus.EX).toBeUndefined();
  });

  it("reads inquiries with bureau and match group", () => {
    expect(cf.inquiries).toEqual([
      { date: "8/17/2024", creditor: "TEST AUTO", bureau: "EX", matchedAccount: true },
      { date: "11/13/2025", creditor: "TEST BANK CARD", bureau: "TU", matchedAccount: false },
    ]);
    expect(cf.publicRecordsReported).toBe(false);
  });

  it("returns an explicit warning for unsupported providers", () => {
    const u = parseCreditFile("Some other bureau report");
    expect(u.provider).toBe("unknown");
    expect(u.warnings[0]).toMatch(/No account-level parser/);
  });
});

describe("Claude extraction (lean fields)", () => {
  const raw = {
    report_date: "09/22/2026",
    scores: { transunion: 611, experian: 603, equifax: 585 },
    score_model: "VantageScore 3.0",
    accounts: [
      {
        creditor: "TEST BANK CARD",
        original_creditor: null,
        account_mask: "411111****",
        section: "revolving",
        transunion: {
          date_opened: "03/05/2020", date_last_activity: null, balance: 230,
          credit_limit: 500, past_due: 0, account_type: "Credit Card",
          account_status: "Open", payment_status: "Current", remarks: null,
          dispute_status: "Account not disputed", late_30: 0, late_60: 0, late_90: 0,
        },
        experian: null,
        equifax: null,
      },
      {
        creditor: "SAMPLE COLLECTIONS LLC",
        original_creditor: "TEST WIRELESS",
        account_mask: "98765****",
        section: "collection",
        transunion: {
          date_opened: "08/2023", date_last_activity: null, balance: "$618",
          credit_limit: null, past_due: 618, account_type: "Collection",
          account_status: "Open", payment_status: "Collection",
          remarks: "Disputed, meets FCRA requirements", dispute_status: "Account not disputed",
          late_30: 1, late_60: 1, late_90: 2,
        },
        experian: null,
        equifax: null,
      },
    ],
    inquiries: [{ date: "8/17/2024", creditor: "TEST AUTO", bureau: "experian" }],
    public_records_count: 0,
    unreadable_pages: [],
  };

  it("builds a PDF + JSON-schema request on the configured model", () => {
    const p: any = buildCreditFileExtractionParams({ pdfBase64: "QUJD", model: "claude-sonnet-4-6" });
    expect(p.model).toBe("claude-sonnet-4-6");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p.messages[0].content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "QUJD" },
    });
    expect(p.tool_choice).toBeUndefined();
  });

  it("parses into the shared CreditFile model", () => {
    const cf = parseCreditFileExtraction(JSON.stringify(raw), "smartcredit");
    expect(cf.accounts).toHaveLength(2);
    expect(cf.accounts[1].bureaus.TU!.balance).toBe(618);
    expect(cf.accounts[1].headerStatus).toBe("Original creditor: TEST WIRELESS");
    expect(cf.scoreModel).toBe("VantageScore 3.0");
    expect(cf.inquiries[0].bureau).toBe("EX");
  });

  it("sends images as image blocks (photos / screenshots of a report)", () => {
    const p: any = buildCreditFileExtractionParams({
      fileBase64: "QUJD",
      mediaType: "image/jpeg",
      model: "m",
    });
    expect(p.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { media_type: "image/jpeg" },
    });
  });

  it("throws on non-JSON so the job fails loudly", () => {
    expect(() => parseCreditFileExtraction("not json", "smartcredit")).toThrow();
  });

  it("cross-checks against the text skeleton", () => {
    const extracted = parseCreditFileExtraction(raw, "smartcredit");
    const skeleton = parseCreditFile(SMARTCREDIT);
    const { issues, confidence } = crossCheckCreditFile(extracted, skeleton);
    // Skeleton found 3 accounts (one on an image page) — extraction has 2.
    expect(issues.map((i) => i.code)).toContain("account_count_mismatch");
    expect(issues.map((i) => i.code)).toContain("inquiry_count_mismatch");
    expect(confidence).toBeLessThan(1);
  });

  it("flags score mismatches as errors", () => {
    const extracted = parseCreditFileExtraction(
      { ...raw, scores: { transunion: 600, experian: 603, equifax: 585 } },
      "smartcredit",
    );
    const { issues } = crossCheckCreditFile(extracted, parseCreditFile(SMARTCREDIT));
    expect(issues.find((i) => i.code === "score_mismatch")?.severity).toBe("error");
  });
});
