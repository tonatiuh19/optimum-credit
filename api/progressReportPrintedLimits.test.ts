/**
 * SmartCredit printed credit limits (Nov 6, 2026 — Emiliano): the account read took a card's
 * High Balance ($1,279) as its limit ($500), so revolving limits never matched the report's
 * Credit Utilization total and every round was held. Made-up report text in the same layout.
 */
import { describe, expect, it } from "vitest";
import { parseSmartCreditPrintedLimits, type Bureau, type BureauTradeline, type CreditAccount, type CreditFile } from "./creditFile";
import { pv2ApplyPrintedLimits, pv2ParsePullSummary, type Pv2PullSummary } from "./progressReportV2";

const row = (...c: string[]) => c.join(" \t");
const GROUP = "TransUnion® \tExperian® \tEquifax®";
const OPEN_LABELS = ["Account Number", "High Balance", "Balance Owed", "Account Status", "Payment Amount", "Account Type", "Credit Limit", "Utilization", "Payment History - Last 2 Years"];
const CLOSED_LABELS = ["Account Number", "Balance Owed", "Account Status", "Account Type", "Credit Limit", "Payment History - Last 2 Years"];

/**
 * Text as pdf-parse prints a SmartCredit 3B: header, status lines, labels, then the value block.
 * Bank of America's block is split by a page break: its tail (limit + utilization) prints
 * after the next account's labels, with a payment-grid row in between.
 */
function report(): string {
  return [
    "Revolving Accounts",
    "ACME CARD 411111****",
    "Closed On 01/01/2024",
    ...CLOSED_LABELS,
    GROUP,
    row("411111****", "411111****", "411111****"),
    row("$0", "$0", "$0"),
    row("Closed", "Closed", "Closed"),
    row("Charge account", "Charge account", "——"),
    row("$2,300", "$2,300", "$0"),
    "BK OF AMER ****",
    "Negative Open",
    "31% Credit Utilization",
    ...OPEN_LABELS,
    GROUP,
    row("****", "****", "552433****"),
    row("$1,279", "$1,279", "$0"), // High Balance: the read took this as the limit
    row("$153", "$153", "$153"),
    row("Open", "Open", "Open"),
    row("$35", "$35", "$35"),
    "11/7/26, 12:57 AM \tUltra 4K 3B Report",
    "https://member.smartcredit.com/reports/3b/print?orderId=x \t2/16",
    "-- 2 of 16 --",
    "STORE CARD 603534****",
    "Negative Closed On 12/22/2025",
    ...CLOSED_LABELS,
    "TransUnion® \t30",
    row("30", "30", "30"), // payment grid, not a value
    row("Credit Card", "Credit Card", "Credit Card"),
    row("$500", "$500", "$500"),
    row("31%", "31%", "31%"),
    GROUP,
    row("603534****", "603534****", "603534****"),
    row("$0", "$0", "$0"),
    row("Closed", "Closed", "Closed"),
    row("Charge account", "Charge account", "——"),
    row("$200", "$200", "$0"),
    // One card printed as two blocks: TransUnion + Equifax, then Experian alone.
    "US BANK 403784****",
    "Negative Open",
    "96% Credit Utilization",
    ...OPEN_LABELS,
    GROUP,
    row("403784****", "——", "403784****"),
    row("$594", "——", "$0"),
    row("$478", "——", "$478"),
    row("Open", "——", "Open"),
    row("$53", "——", "$53"),
    row("Credit Card", "——", "Credit Card"),
    row("$500", "——", "$500"),
    row("96%", "——", "96%"),
    "US BANK ****",
    "Negative Open",
    "96% Credit Utilization",
    ...OPEN_LABELS,
    GROUP,
    row("——", "****", "——"),
    row("——", "$594", "——"),
    row("——", "$478", "——"),
    row("——", "Open", "——"),
    row("——", "$53", "——"),
    row("——", "Credit Card", "——"),
    row("——", "$500", "——"),
    row("——", "96%", "——"),
    // Header printed as an image: labels only, no values in the text.
    ...OPEN_LABELS,
    "KOHLS CARD 639305****",
    "Open",
    ...OPEN_LABELS,
    GROUP,
    row("639305****", "639305****", "639305****"),
    row("$600", "$600", "$600"),
    row("$0", "$0", "$0"),
    row("Open", "Open", "Open"),
    row("$0", "$0", "$0"),
    row("Credit Card", "Credit Card", "Credit Card"),
    row("$600", "$600", "$600"),
    row("——", "——", "——"), // Utilization with no balance
    "Public Records",
    "An overview of your public records",
  ].join("\n");
}

describe("parseSmartCreditPrintedLimits", () => {
  const byName = () => Object.fromEntries(parseSmartCreditPrintedLimits(report()).map((p) => [`${p.creditor} ${p.mask}`, p.limits]));

  it("reads the Credit Limit row, not High Balance, across a page break", () => {
    expect(byName()["BK OF AMER ****"]).toEqual({ TU: 500, EX: 500, EQ: 500 });
  });

  it("closed accounts (no Utilization row), split cards and $0-balance utilization rows", () => {
    const m = byName();
    expect(m["ACME CARD 411111****"]).toEqual({ TU: 2300, EX: 2300, EQ: 0 });
    expect(m["STORE CARD 603534****"]).toEqual({ TU: 200, EX: 200, EQ: 0 });
    expect(m["US BANK 403784****"]).toEqual({ TU: 500, EQ: 500 });
    expect(m["US BANK ****"]).toEqual({ EX: 500 });
    expect(m["KOHLS CARD 639305****"]).toEqual({ TU: 600, EX: 600, EQ: 600 });
  });

  it("an account whose header is an image is skipped, later accounts still line up", () => {
    expect(Object.keys(byName())).toHaveLength(6);
  });

  it("other layouts and empty text give nothing", () => {
    expect(parseSmartCreditPrintedLimits("")).toEqual([]);
    expect(parseSmartCreditPrintedLimits("Credit Summary\nRepositories:\n")).toEqual([]);
  });
});

const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({ accountStatus: "Open", balance: 0, creditLimit: 0, ...o }) as BureauTradeline;
const acct = (creditor: string, mask: string | null, bureaus: Partial<Record<Bureau, BureauTradeline>>, section: CreditAccount["section"] = "revolving"): CreditAccount =>
  ({ creditor, mask, section, headerStatus: null, confident: true, bureaus }) as CreditAccount;
const file = (accounts: CreditAccount[]): CreditFile => ({ provider: "smartcredit", reportDate: "12/28/2025", scores: { TU: 600, EX: 600, EQ: 600 }, accounts, inquiries: [] }) as unknown as CreditFile;
const summary = (limit: Partial<Record<Bureau, number>>, printedLimits = parseSmartCreditPrintedLimits(report())): Pv2PullSummary =>
  ({
    perBureau: { TU: null, EX: null, EQ: null },
    revolving: { TU: limit.TU != null ? { used: 0, limit: limit.TU } : null, EX: limit.EX != null ? { used: 0, limit: limit.EX } : null, EQ: limit.EQ != null ? { used: 0, limit: limit.EQ } : null },
    printedLimits,
  }) as Pv2PullSummary;
const limitOf = (f: CreditFile, creditor: string, b: Bureau) => f.accounts.find((a) => a.creditor === creditor)!.bureaus[b]?.creditLimit;

// The read: Bank of America's High Balance taken as its limit on TU / EX (Emiliano's case).
const emilianoRead = () =>
  file([
    acct("BK OF AMER", null, { TU: tl({ creditLimit: 1279, balance: 153 }), EX: tl({ creditLimit: 1279, balance: 153 }), EQ: tl({ creditLimit: 500, balance: 153 }) }),
    acct("US BANK", "3784", { TU: tl({ creditLimit: 500, balance: 478 }), EX: tl({ creditLimit: 500, balance: 478 }), EQ: tl({ creditLimit: 500, balance: 478 }) }),
    acct("KOHLS CARD", "9305", { TU: tl({ creditLimit: 600 }), EX: tl({ creditLimit: 600 }), EQ: tl({ creditLimit: 600 }) }),
    acct("ACME CARD", "4111", { TU: tl({ accountStatus: "Closed", creditLimit: 9999 }) }),
  ]);

describe("pv2ApplyPrintedLimits", () => {
  it("Emiliano: repairs the wrong limit so totals match the printed $1,600", () => {
    const out = pv2ApplyPrintedLimits(emilianoRead(), summary({ TU: 1600, EX: 1600, EQ: 1600 }));
    expect(limitOf(out, "BK OF AMER", "TU")).toBe(500);
    expect(limitOf(out, "BK OF AMER", "EX")).toBe(500);
    expect(limitOf(out, "BK OF AMER", "EQ")).toBe(500);
  });

  it("closed accounts are never touched (they are not in the total)", () => {
    const out = pv2ApplyPrintedLimits(emilianoRead(), summary({ TU: 1600 }));
    expect(limitOf(out, "ACME CARD", "TU")).toBe(9999);
  });

  it("a read that already matches its total is returned unchanged", () => {
    const read = emilianoRead();
    expect(pv2ApplyPrintedLimits(read, summary({ TU: 2379, EX: 2379, EQ: 1600 }))).toBe(read);
  });

  it("a repair that would not reach the printed total is not applied", () => {
    const read = emilianoRead();
    expect(pv2ApplyPrintedLimits(read, summary({ TU: 3000 }))).toBe(read);
  });

  it("no printed total or no printed limits → unchanged", () => {
    const read = emilianoRead();
    expect(pv2ApplyPrintedLimits(read, summary({}))).toBe(read);
    expect(pv2ApplyPrintedLimits(read, summary({ TU: 1600 }, []))).toBe(read);
    expect(pv2ApplyPrintedLimits(read, null)).toBe(read);
  });

  it("two printed entries for the same creditor that disagree are ambiguous → that card is left as read", () => {
    const printed = [
      { creditor: "BK OF AMER", mask: "****", limits: { TU: 500 } },
      { creditor: "BK OF AMER", mask: "****", limits: { TU: 700 } },
    ];
    const read = emilianoRead();
    expect(pv2ApplyPrintedLimits(read, summary({ TU: 1600 }, printed))).toBe(read);
  });

  it("masks keep look-alike cards apart (same creditor, different numbers)", () => {
    const read = file([
      acct("WF CARD", "4147", { TU: tl({ creditLimit: 9000 }) }),
      acct("WF CARD", "4426", { TU: tl({ creditLimit: 1000 }) }),
    ]);
    const printed = [
      { creditor: "WF CARD", mask: "414718****", limits: { TU: 1000 } },
      { creditor: "WF CARD", mask: "442644****", limits: { TU: 1000 } },
    ];
    const out = pv2ApplyPrintedLimits(read, summary({ TU: 2000 }, printed));
    expect(out.accounts.map((a) => a.bureaus.TU!.creditLimit)).toEqual([1000, 1000]);
  });

  it("the summary parser stores printed limits for SmartCredit text (cached reads are re-parsed: v3)", () => {
    const text = `Ultra 4K 3B Report\n${row("12/28/2025", "12/28/2025", "12/28/2025")}\n${report()}`;
    const s = pv2ParsePullSummary(text);
    expect(s).toMatchObject({ parserVersion: 3, format: "smartcredit" });
    expect(s!.printedLimits).toHaveLength(6);
  });
});
