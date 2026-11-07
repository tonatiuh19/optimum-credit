/**
 * SmartCredit printed credit limits (Nov 6, 2026 — a client): the account read took a card's
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

// The read: Bank of America's High Balance taken as its limit on TU / EX (a client case).
const emilianoRead = () =>
  file([
    acct("BK OF AMER", null, { TU: tl({ creditLimit: 1279, balance: 153 }), EX: tl({ creditLimit: 1279, balance: 153 }), EQ: tl({ creditLimit: 500, balance: 153 }) }),
    acct("US BANK", "3784", { TU: tl({ creditLimit: 500, balance: 478 }), EX: tl({ creditLimit: 500, balance: 478 }), EQ: tl({ creditLimit: 500, balance: 478 }) }),
    acct("KOHLS CARD", "9305", { TU: tl({ creditLimit: 600 }), EX: tl({ creditLimit: 600 }), EQ: tl({ creditLimit: 600 }) }),
    acct("ACME CARD", "4111", { TU: tl({ accountStatus: "Closed", creditLimit: 9999 }) }),
  ]);

describe("pv2ApplyPrintedLimits", () => {
  it("a client: repairs the wrong limit so totals match the printed $1,600", () => {
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

describe("read completeness counts (Nov 6, 2026 — a client)", () => {
  it("a stale entry count below the accounts read never makes a complete file look short", async () => {
    const { pv2ReadEntries, pv2SummaryShortfall } = await import("./progressReportV2");
    const accounts = Array.from({ length: 38 }, (_, i) => acct(`LENDER ${i}`, String(i), { TU: tl({}) }));
    const f = { ...file(accounts), readEntries: 34 } as CreditFile;
    expect(pv2ReadEntries(f)).toBe(38);
    const s = { perBureau: { TU: null, EX: null, EQ: null }, revolving: { TU: null, EX: null, EQ: null }, accountsPrinted: 38 } as Pv2PullSummary;
    expect(pv2SummaryShortfall(f, s)).toBeNull();
    expect(pv2SummaryShortfall({ ...f, accounts: accounts.slice(0, 30), readEntries: 30 } as CreditFile, s)).toMatch(/30 of 38 accounts/);
  });
});

describe("printed sections (Nov 6, 2026 — a client: lines of credit counted as revolving)", () => {
  // SmartCredit's utilization table counts only "Revolving Accounts"; a line of credit prints in its own section.
  const text = [
    "Revolving Accounts",
    "CARD ONE 510004****",
    "Open",
    ...OPEN_LABELS,
    GROUP,
    row("510004****", "——", "510004****"),
    row("$0", "——", "$0"),
    row("$0", "——", "$0"),
    row("Open", "——", "Open"),
    row("$0", "——", "$0"),
    row("Credit Card", "——", "Credit Card"),
    row("$300", "——", "$300"),
    row("0%", "——", "0%"),
    "Installment Accounts",
    "CREDIT UNION 133800****",
    "Closed",
    ...CLOSED_LABELS,
    GROUP,
    row("133800****", "133800****", "133800****"),
    row("$0", "$0", "$0"),
    row("Closed", "Closed", "Closed"),
    row("Installment", "Installment", "Installment"),
    row("$0", "$0", "$0"),
    "Line of Credit Accounts",
    "CREDIT UNION 133800****",
    "Open",
    ...OPEN_LABELS,
    GROUP,
    row("133800****", "133800****", "133800****"),
    row("$300", "$300", "$300"),
    row("$253", "$240", "$266"),
    row("Open", "Open", "Open"),
    row("$25", "$25", "$25"),
    row("Line of Credit", "Line of Credit", "Line of Credit"),
    row("$300", "$300", "$300"),
    row("89%", "80%", "89%"),
    "TILT LN5BNO****",
    "Open",
    ...OPEN_LABELS,
    GROUP,
    row("LN5BNO****", "LN5BNO****", "LN5BNO****"),
    row("$275", "$275", "$275"),
    row("$269", "$269", "$269"),
    row("Open", "Open", "Open"),
    row("$30", "$30", "$30"),
    row("Line of Credit", "Line of Credit", "Line of Credit"),
    row("$275", "$275", "$275"),
    row("98%", "98%", "98%"),
    "Public Records",
    "An overview of your public records",
  ].join("\n");

  it("each printed account carries its section; masks with letters split off the creditor", () => {
    const p = parseSmartCreditPrintedLimits(text);
    expect(p.map((x) => `${x.creditor}|${x.mask}|${x.section}`)).toEqual([
      "CARD ONE|510004****|revolving",
      "CREDIT UNION|133800****|installment",
      "CREDIT UNION|133800****|other",
      "TILT|LN5BNO****|other",
    ]);
  });

  const read = () =>
    file([
      acct("CARD ONE", "0004", { TU: tl({ creditLimit: 300 }), EQ: tl({ creditLimit: 300 }) }),
      acct("CREDIT UNION", "3800", { TU: tl({ creditLimit: 300, balance: 253 }), EX: tl({ creditLimit: 300, balance: 240 }), EQ: tl({ creditLimit: 300, balance: 266 }) }),
      acct("TILT", "5BNO", { TU: tl({ creditLimit: 275, balance: 269 }), EX: tl({ creditLimit: 275, balance: 269 }), EQ: tl({ creditLimit: 275, balance: 269 }) }),
      acct("COLLECTOR", "4801", { TU: tl({ creditLimit: 0, balance: 900 }) }, "collection"),
    ]);
  const jose = (printedLimits = parseSmartCreditPrintedLimits(text)) => summary({ TU: 300, EQ: 300 }, printedLimits);

  it("a client: the line of credit and Tilt leave revolving, so limits match SmartCredit's $300", () => {
    const out = pv2ApplyPrintedLimits(read(), jose());
    expect(out.accounts.map((a) => a.section)).toEqual(["revolving", "other", "other", "collection"]);
  });

  it("several printed accounts with one number: the one whose limits agree decides the section", () => {
    // The closed loan (limit $0) and the line of credit ($300) share 133800: the read's $300 picks the line of credit.
    const out = pv2ApplyPrintedLimits(read(), jose());
    expect(out.accounts[1].section).toBe("other");
  });

  it("collections are never reclassified", () => {
    const printed = [...parseSmartCreditPrintedLimits(text), { creditor: "COLLECTOR", mask: "48014801**", limits: {}, section: "other" as const }];
    expect(pv2ApplyPrintedLimits(read(), jose(printed)).accounts[3].section).toBe("collection");
  });

  it("a read that already matches keeps its sections", () => {
    const r = read();
    expect(pv2ApplyPrintedLimits(r, summary({ TU: 875, EQ: 875 }, parseSmartCreditPrintedLimits(text)))).toBe(r);
  });
});

describe("pv2CreditorShortfall (one of many look-alike accounts missing)", () => {
  const sk = (accounts: CreditAccount[]) => ({ ...file(accounts), provider: "smartcredit", imagePages: 0 }) as CreditFile;
  const loans = (n: number, bureaus: Bureau[] = ["TU", "EX", "EQ"]) =>
    Array.from({ length: n }, (_, i) => acct("CENTRAL RESEARCH INC/D", `55${i}`, Object.fromEntries(bureaus.map((b) => [b, tl({ balance: 1000 + i })]))));

  it("11 printed, 10 read → named with the counts", async () => {
    const { pv2CreditorShortfall } = await import("./progressReportV2");
    expect(pv2CreditorShortfall(file(loans(10)), sk(loans(11)))).toEqual([{ creditor: "CENTRAL RESEARCH INC/D", printed: 11, read: 10 }]);
  });

  it("one debt printed as two blocks (TransUnion / Equifax) merged into one account is not missing", async () => {
    const { pv2CreditorShortfall } = await import("./progressReportV2");
    const printed = [acct("LVNV FUNDING LLC", "1111", { TU: tl({}) }), acct("LVNV FUNDING LLC", "2222", { EQ: tl({}) })];
    const read = [acct("LVNV FUNDING", "1111", { TU: tl({}), EQ: tl({}) })];
    expect(pv2CreditorShortfall(file(read), sk(printed))).toEqual([]);
  });

  it("a creditor the read spells differently, image pages, other providers → nothing", async () => {
    const { pv2CreditorShortfall } = await import("./progressReportV2");
    expect(pv2CreditorShortfall(file([acct("XYZ", "1", { TU: tl({}) })]), sk(loans(3)))).toEqual([]);
    expect(pv2CreditorShortfall(file(loans(1)), { ...sk(loans(3)), imagePages: 2 } as CreditFile)).toEqual([]);
    expect(pv2CreditorShortfall(file(loans(1)), { ...sk(loans(3)), provider: "mfsn" } as unknown as CreditFile)).toEqual([]);
  });
});

describe("SmartCredit Days Late rows with ® (Ultra 4K 3B)", () => {
  it("are read, so each account knows which bureaus report it", async () => {
    const { parseSmartCredit } = await import("./creditFile");
    const text = [
      "Revolving Accounts",
      "CARD ONE 510004****",
      "Open",
      ...OPEN_LABELS,
      "TransUnion® 30: 1 60: 0 90: 0 \tExperian® \t30: –– 60: –– 90: –– \tEquifax® \t30: 0 60: 0 90: 0",
      "Public Records",
      "An overview of your public records",
    ].join("\n");
    const f = parseSmartCredit(text);
    expect(Object.keys(f.accounts[0].bureaus).sort()).toEqual(["EQ", "TU"]);
    expect(f.accounts[0].bureaus.TU!.late30).toBe(1);
    expect(f.warnings.some((w) => /days-late/.test(w))).toBe(false);
  });
});

describe("reconciled accounts are not dropped as repeats", () => {
  it("look-alike loans (same creditor, number and open date) with different balances are both kept", async () => {
    const { mergeMissingAccounts } = await import("./creditAnalysisFromFile");
    const loan = (balance: number) => acct("DEPT OF ED/AIDVANTAGE", "0001", { TU: tl({ balance, dateOpened: "08/01/2019" }) }, "installment");
    // Without a known shortfall a look-alike is treated as a repeat (the reconcile pass re-listing an account).
    expect(mergeMissingAccounts(file([loan(4100)]), [loan(4157)]).added).toBe(0);
    // Known short by one: the different loan is added once; an exact repeat never is.
    const out = mergeMissingAccounts(file([loan(4100)]), [loan(4100), loan(4157), loan(4200)], new Map([["deptofed", 1]]));
    expect(out.added).toBe(1);
    expect(out.file.accounts.map((a) => a.bureaus.TU!.balance)).toEqual([4100, 4157]);
  });
});

describe("Days Late rows when an account header has none (Nov 6, 2026 — 96 rows for 97 headers)", () => {
  it("each row goes to the header printed before it; the account without a row gets no bureaus", async () => {
    const { parseSmartCredit } = await import("./creditFile");
    const late = (tu: string) => `TransUnion® 30: ${tu} 60: 0 90: 0 \tExperian® \t30: –– 60: –– 90: –– \tEquifax® \t30: 0 60: 0 90: 0`;
    const block = (name: string, withLate: string | null) => [name, "Open", ...OPEN_LABELS, ...(withLate ? [late(withLate)] : [])];
    const text = ["Revolving Accounts", ...block("ONE 111111****", "1"), ...block("TWO 222222****", null), ...block("THREE 333333****", "3"), "Public Records", "An overview of your public records"].join("\n");
    const f = parseSmartCredit(text);
    expect(f.accounts.map((a) => a.bureaus.TU?.late30 ?? null)).toEqual([1, null, 3]);
    expect(f.accounts[0].bureaus.EX).toBeUndefined();
  });
});

describe("MyFreeScoreNow table of contents (any missing entry, with creditor hints)", () => {
  const toc = (names: string[]): Pv2PullSummary =>
    ({ perBureau: { TU: null, EX: null, EQ: null }, revolving: { TU: null, EX: null, EQ: null }, accountsPrinted: names.length, tocCreditors: names }) as Pv2PullSummary;
  const ed = (n: number) => Array.from({ length: n }, () => "Ed Financial/esa");

  it("a client: 4 Ed Financial listed, 3 read, 1 entry missing → named, never more than missing", async () => {
    const { pv2TocCreditorShortfall } = await import("./progressReportV2");
    const read = { ...file([...ed(3), "Other A", "Other B"].map((c, i) => acct(c, String(i), { TU: tl({}) }))), readEntries: 5 } as CreditFile;
    expect(pv2TocCreditorShortfall(read, toc([...ed(4), "Other A", "Other B"]))).toEqual([{ creditor: "Ed Financial/esa", printed: 4, read: 3 }]);
  });

  it("a complete read (entries = table of contents) needs no hint even when copies were merged", async () => {
    const { pv2TocCreditorShortfall } = await import("./progressReportV2");
    const read = { ...file([acct("LVNV FUNDING", "1", { TU: tl({}), EQ: tl({}) })]), readEntries: 2 } as CreditFile;
    expect(pv2TocCreditorShortfall(read, toc(["LVNV Funding", "LVNV Funding"]))).toEqual([]);
  });

  it("the summary parser keeps each entry's creditor (status suffix and page number removed)", () => {
    const text = ["Three Bureau Credit Report", "Equifax Accounts Summary", "2. Revolving Accounts 4", "2.1 Oportun/webbank (CLOSED) 4", "2.2 Thd/cbna 21", "4. Installment Accounts 24", "4.1 Ed Financial/esa (CLOSED) 24"].join("\n");
    const s = pv2ParsePullSummary(text);
    expect(s?.tocCreditors).toEqual(["Oportun/webbank", "Thd/cbna", "Ed Financial/esa"]);
    expect(s?.accountsPrinted).toBe(3);
  });
});

describe("printed balances and inquiries (guarded like limits)", () => {
  const sumOf = (o: Partial<Record<Bureau, number>>) => ({ perBureau: Object.fromEntries((["TU", "EX", "EQ"] as Bureau[]).map((b) => [b, o[b] == null ? null : { totalAccounts: null, openAccounts: null, closedAccounts: null, balances: o[b], publicRecords: null, inquiries2y: null }])), revolving: { TU: null, EX: null, EQ: null } }) as unknown as Pv2PullSummary;
  // 11 look-alike loans print one number; the Date Opened row tells them apart.
  const printedLoans = [
    { creditor: "CENTRAL RESEARCH INC/D", mask: "510000****", limits: {}, balances: { TU: 1036 }, opened: { TU: "05/01/2015" } },
    { creditor: "CENTRAL RESEARCH INC/D", mask: "510000****", limits: {}, balances: { TU: 6834 }, opened: { TU: "08/01/2016" } },
  ];
  const loan = (balance: number, dateOpened: string) => acct("CENTRAL RESEARCH INC/D", "0000", { TU: tl({ balance, dateOpened }) }, "installment");

  it("a misread balance is repaired from its Balance Owed row, picked by Date Opened", async () => {
    const { pv2ApplyPrintedBalances } = await import("./progressReportV2");
    const s = { ...sumOf({ TU: 7870 }), printedLimits: printedLoans } as Pv2PullSummary;
    const out = pv2ApplyPrintedBalances(file([loan(1036, "05/01/2015"), loan(9999, "08/01/2016")]), s);
    expect(out.accounts.map((a) => a.bureaus.TU!.balance)).toEqual([1036, 6834]);
  });

  it("matching totals, a repair that would not match, or no Date Opened to choose by → unchanged", async () => {
    const { pv2ApplyPrintedBalances } = await import("./progressReportV2");
    const ok = file([loan(1036, "05/01/2015"), loan(6834, "08/01/2016")]);
    expect(pv2ApplyPrintedBalances(ok, { ...sumOf({ TU: 7870 }), printedLimits: printedLoans } as Pv2PullSummary)).toBe(ok);
    const off = file([loan(1036, "05/01/2015"), loan(9999, "08/01/2016")]);
    expect(pv2ApplyPrintedBalances(off, { ...sumOf({ TU: 50000 }), printedLimits: printedLoans } as Pv2PullSummary)).toBe(off);
    const noDate = file([loan(1036, "05/01/2015"), loan(9999, "")]);
    expect(pv2ApplyPrintedBalances(noDate, { ...sumOf({ TU: 7870 }), printedLimits: printedLoans } as Pv2PullSummary)).toBe(noDate);
  });

  it("the Balance Owed row is read even when its label prints on the same line", () => {
    const text = [
      "Installment Accounts",
      "CENTRAL RESEARCH INC/D 510000****",
      "Open",
      "Account Number",
      GROUP,
      row("510000****", "510000****", "510000****"),
      row("$690", "$690", "$690"),
      row("08/31/2026", "——", "——"),
      row("08/31/2026", "08/01/2026", "07/01/2026"),
      row("08/31/2026", "08/31/2026", "07/01/2026"),
      row("05/01/2015", "05/01/2015", "05/01/2015"),
      "Balance Owed \t$1,036 \t$1,036 \t$1,032",
      row("——", "——", "——"),
      "Public Records",
      "An overview of your public records",
    ].join("\n");
    const [p] = parseSmartCreditPrintedLimits(text);
    expect(p.balances).toEqual({ TU: 1036, EX: 1036, EQ: 1032 });
    expect(p.opened).toEqual({ TU: "05/01/2015", EX: "05/01/2015", EQ: "05/01/2015" });
  });

  it("inquiries: the printed list replaces a bureau's read only when it matches the printed count", async () => {
    const { pv2ApplyPrintedInquiries } = await import("./progressReportV2");
    const q = (creditor: string, bureau: Bureau, date = "09/01/2026") => ({ creditor, bureau, date, matchedAccount: null });
    const read = { ...file([]), reportDate: "10/01/2026", inquiries: [q("A", "TU"), q("X", "EX")] } as CreditFile;
    const s = (tu: number) => ({ ...sumOf({}), perBureau: { TU: { inquiries2y: tu }, EX: { inquiries2y: 1 }, EQ: null }, printedInquiries: [q("A", "TU"), q("B", "TU"), q("X", "EX")] }) as unknown as Pv2PullSummary;
    expect(pv2ApplyPrintedInquiries(read, s(2)).inquiries.map((x) => `${x.bureau}:${x.creditor}`).sort()).toEqual(["EX:X", "TU:A", "TU:B"]);
    expect(pv2ApplyPrintedInquiries(read, s(3))).toBe(read); // the printed list does not reach the total either
  });
});

describe("printed late counts (Days Late - Last 7 Years)", () => {
  const entry = (o: Partial<{ mask: string; lates: any; opened: any; balances: any }> = {}) => ({ creditor: "JEFFERSON CAPITAL SYST", mask: "406154****", limits: {}, ...o });
  const s = (printedLimits: any[]) => ({ perBureau: { TU: null, EX: null, EQ: null }, revolving: { TU: null, EX: null, EQ: null }, printedLimits }) as unknown as Pv2PullSummary;
  const read = (o: Partial<BureauTradeline> = {}) => file([acct("JEFFERSON CAPITAL SYST", "6154", { EQ: tl({ late30: 0, late60: 0, late90: 19, ...o }) }, "collection")]);

  it("a misread count is replaced by the printed row (read 19 x 90, printed 3)", async () => {
    const { pv2ApplyPrintedLates } = await import("./progressReportV2");
    const out = pv2ApplyPrintedLates(read(), s([entry({ lates: { EQ: { late30: 0, late60: 0, late90: 3 } } })]));
    expect(out.accounts[0].bureaus.EQ).toMatchObject({ late30: 0, late60: 0, late90: 3 });
  });

  it("never clears lates the read saw in the payment grid", async () => {
    const { pv2ApplyPrintedLates } = await import("./progressReportV2");
    const r = read({ late30: 1, late90: 0, gridMarks: ["03/2025:30"] });
    expect(pv2ApplyPrintedLates(r, s([entry({ lates: { EQ: { late30: 0, late60: 0, late90: 0 } } })]))).toBe(r);
  });

  it("two printed accounts that could both be this one → left as read; Date Opened can settle it", async () => {
    const { pv2ApplyPrintedLates } = await import("./progressReportV2");
    const two = [entry({ lates: { EQ: { late30: 1, late60: 0, late90: 0 } }, opened: { EQ: "01/01/2020" } }), entry({ lates: { EQ: { late30: 2, late60: 0, late90: 0 } }, opened: { EQ: "06/01/2021" } })];
    const r = read({ dateOpened: null });
    expect(pv2ApplyPrintedLates(r, s(two))).toBe(r);
    const dated = pv2ApplyPrintedLates(read({ dateOpened: "06/01/2021" }), s(two));
    expect(dated.accounts[0].bureaus.EQ!.late30).toBe(2);
  });
});

describe("Before ↔ After matching picks the closest look-alike", () => {
  it("two loans with one number and open month pair by balance, not by order", async () => {
    const { pv2MatchAccounts } = await import("./progressReportV2");
    const loan = (balance: number) => acct("DEPT OF ED", "123456", { TU: tl({ balance, dateOpened: "08/01/2019" }) }, "installment");
    const before = [loan(5000), loan(9000)];
    const after = [loan(8950), loan(4980)];
    const m = pv2MatchAccounts(before, after);
    expect(m.get(before[0])!.bureaus.TU!.balance).toBe(4980);
    expect(m.get(before[1])!.bureaus.TU!.balance).toBe(8950);
  });
});

describe("held-report alert", () => {
  it("lists only failed checks, with their detail; nothing failed → no alert", async () => {
    const { reportHeldReasons, reportHeldAlertAdminIds } = await import("./index");
    expect(reportHeldReasons([
      { key: "account_totals", pass: false, detail: "After EQ: 16 accounts read, summary 24" },
      { key: "collections", pass: null, detail: "pull prints no summary" },
      { key: "scores", pass: true, detail: "ok" },
    ])).toEqual(["account totals: After EQ: 16 accounts read, summary 24"]);
    expect(reportHeldReasons([{ key: "scores", pass: true }])).toEqual([]);
    expect(reportHeldAlertAdminIds({ REPORT_HELD_ALERT_ADMIN_IDS: "7, x, 9" } as any)).toEqual([7, 9]);
    expect(reportHeldAlertAdminIds({ REPORT_RELEASE_MANAGER_IDS: "30001,90001" } as any)).toEqual([30001, 90001]);
  });
});

describe('"Unknown Accounts" is a printed section (SmartCredit leaves it out of utilization)', () => {
  it("a card printed there leaves revolving so the limits match", () => {
    const text = [
      "Revolving Accounts",
      "CARD ONE 517805****",
      "Open",
      ...OPEN_LABELS,
      GROUP,
      row("517805****", "517805****", "——"),
      row("$300", "$300", "——"),
      row("$216", "$216", "——"),
      row("Open", "Open", "——"),
      row("$25", "$25", "——"),
      row("Credit Card", "Credit Card", "——"),
      row("$300", "$300", "——"),
      row("72%", "72%", "——"),
      "Unknown Accounts",
      "STORE CARD 402241****",
      "Open",
      ...OPEN_LABELS,
      GROUP,
      row("402241****", "402241****", "——"),
      row("$350", "$350", "——"),
      row("$0", "$0", "——"),
      row("Open", "Open", "——"),
      row("$0", "$0", "——"),
      row("Credit Card", "Credit Card", "——"),
      row("$350", "$350", "——"),
      row("0%", "0%", "——"),
      "Public Records",
      "An overview of your public records",
    ].join("\n");
    const printed = parseSmartCreditPrintedLimits(text);
    expect(printed.map((p) => p.section)).toEqual(["revolving", "unknown"]);
    const read = file([acct("CARD ONE", "5178", { TU: tl({ creditLimit: 300 }), EX: tl({ creditLimit: 300 }) }), acct("STORE CARD", "2241", { TU: tl({ creditLimit: 350 }), EX: tl({ creditLimit: 350 }) })]);
    const out = pv2ApplyPrintedLimits(read, summary({ TU: 300, EX: 300 }, printed));
    expect(out.accounts.map((a) => a.section)).toEqual(["revolving", "unknown"]);
  });
});

describe("MyFreeScoreNow printed account facts", () => {
  const text = [
    "Three Bureau Credit Report",
    "2. Revolving Accounts 4",
    "2.1 Credit One Bank (CLOSED) 4",
    "4. Installment Accounts 9",
    "4.1 Ed Financial/esa (CLOSED) 9",
    "2.1 Credit One Bank (CLOSED)",
    "Equifax Experian TransUnion",
    "Account Number xxxxxxxxxxxx 2990 xxxxxxxx 5178 xxxxxxxxxxxx 2990",
    "Credit Limit $300 $300 $300",
    "Reported Balance $0 $0 $0",
    "Equifax Experian TransUnion",
    "30 Days Past Due 1 1 1",
    "60 Days Past Due 1 0 1",
    "90 Days Past Due 0 0 0",
    "120 Days Past Due 2 2 2",
    "Date Opened May 01, 2025 May 01, 2025 N/A",
    "Credit Limit $9,999 $9,999 $9,999", // Account Details repeats rows: the first one counts
    "4.1 Ed Financial/esa (CLOSED)",
    "Account Number xxxx 0321 N/A N/A",
    "Credit Limit N/A N/A N/A",
    "Reported Balance $1,036 N/A N/A",
  ].join("\n");

  it("reads each account's rows in Equifax, Experian, TransUnion order", async () => {
    const { parseMfsnPrintedAccounts } = await import("./creditFile");
    const [card, loan] = parseMfsnPrintedAccounts(text);
    expect(card).toMatchObject({
      creditor: "Credit One Bank",
      mask: "2990 5178",
      section: "revolving",
      limits: { EQ: 300, EX: 300, TU: 300 },
      balances: { EQ: 0, EX: 0, TU: 0 },
      opened: { EQ: "05/01/2025", EX: "05/01/2025" },
    });
    // 90-day row only (120+ is its own row), the same meaning as the read's late_90.
    expect(card.lates).toEqual({ EQ: { late30: 1, late60: 1, late90: 0 }, EX: { late30: 1, late60: 0, late90: 0 }, TU: { late30: 1, late60: 1, late90: 0 } });
    expect(loan).toMatchObject({ creditor: "Ed Financial/esa", mask: "0321", section: "installment", limits: {}, balances: { EQ: 1036 } });
  });

  it("the summary carries them, so the same guarded repairs apply", () => {
    const s = pv2ParsePullSummary(`${text}\nEquifax Accounts Summary`);
    expect(s?.format).toBe("mfsn");
    expect(s?.printedLimits?.map((p) => p.creditor)).toEqual(["Credit One Bank", "Ed Financial/esa"]);
  });

  it("text without a table of contents gives nothing", async () => {
    const { parseMfsnPrintedAccounts } = await import("./creditFile");
    expect(parseMfsnPrintedAccounts("Credit Limit $300 $300 $300")).toEqual([]);
  });
});

describe("one card read twice under two fragments of its printed number", () => {
  const printed = [
    { creditor: "CAPITAL ONE", mask: "517805****", limits: { TU: 500 }, section: "revolving" as const },
    { creditor: "CAPITAL ONE", mask: "515676****", limits: { TU: 1000 }, section: "revolving" as const },
  ];
  const card = (mask: string, limit: number, balance: number) => acct("CAPITAL ONE", mask, { TU: tl({ creditLimit: limit, balance, dateOpened: "06/01/2021" }) });

  it('"7805" and "5178" of 517805**** with identical data → one dropped when the totals then match', () => {
    const read = file([card("5676", 1000, 999), card("7805", 500, 101), card("5178", 500, 101)]);
    const out = pv2ApplyPrintedLimits(read, summary({ TU: 1500 }, printed));
    expect(out.accounts).toHaveLength(2);
  });

  it("two real cards (different balances) or totals that already match are never touched", () => {
    const two = file([card("5676", 1000, 999), card("7805", 500, 101), card("5178", 500, 300)]);
    expect(pv2ApplyPrintedLimits(two, summary({ TU: 1500 }, printed))).toBe(two);
    const ok = file([card("5676", 1000, 999), card("7805", 500, 101), card("5178", 500, 101)]);
    expect(pv2ApplyPrintedLimits(ok, summary({ TU: 2000 }, printed))).toBe(ok);
  });
});

describe("repairs are recorded for staff", () => {
  it("each change is a readable note; nothing changed → no notes and the same object", async () => {
    const { pv2ApplyPrintedFacts } = await import("./progressReportV2");
    const read = file([acct("BK OF AMER", null, { TU: tl({ creditLimit: 1279, balance: 153 }), EQ: tl({ creditLimit: 500, balance: 153 }) })]);
    const printed = [{ creditor: "BK OF AMER", mask: "****", limits: { TU: 500, EQ: 500 }, section: "revolving" as const }];
    const out = pv2ApplyPrintedFacts(read, summary({ TU: 500, EQ: 500 }, printed));
    expect(out.printedRepairs).toEqual(["BK OF AMER TU: limit $1,279 → $500"]);
    const same = pv2ApplyPrintedFacts(out, summary({ TU: 500, EQ: 500 }, printed));
    expect(same).toBe(out); // already repaired: no new notes on load
  });
});

describe("a client (Nov 7, 2026): repairs stay one-to-one and per bureau", () => {
  const card = (mask: string, tu: number | null, ex: number | null) =>
    acct("CAPITAL ONE", mask, { ...(tu != null ? { TU: tl({ creditLimit: tu }) } : {}), ...(ex != null ? { EX: tl({ creditLimit: ex }) } : {}) });

  it("two read cards fit one printed block → neither takes its value (the $4,000 card is not 'corrected' to $1,000)", () => {
    const printed = [{ creditor: "CAPITAL ONE", mask: "515676****", limits: { EX: 1000 } }];
    const read = file([card("5676", null, 1000), card("5676", null, 4000)]);
    expect(pv2ApplyPrintedLimits(read, summary({ EX: 2000 }, printed))).toBe(read);
  });

  it("a fix for one bureau never carries changes on another bureau that still does not match", () => {
    // TU is fixed by the printed $500; on EX the printed $500 would not reach the printed total, so EX keeps the read.
    const printed = [{ creditor: "CAPITAL ONE", mask: "517805****", limits: { TU: 500, EX: 500 } }, { creditor: "OTHER", mask: "999999****", limits: {} }];
    const read = file([card("5178", 9000, 9000), acct("OTHER", "9999", { TU: tl({ creditLimit: 1000 }), EX: tl({ creditLimit: 7000 }) })]);
    const out = pv2ApplyPrintedLimits(read, summary({ TU: 1500, EX: 1000 }, printed));
    expect(out.accounts[0].bureaus.TU!.creditLimit).toBe(500);
    expect(out.accounts[0].bureaus.EX!.creditLimit).toBe(9000);
  });

  it("a stored read saved with repairs applied is never reused (it is read again)", async () => {
    const { storedReadIsShort } = await import("./index");
    expect(storedReadIsShort({ accounts: [], printedRepairs: ["x"] }, null)).toBe(true);
    expect(storedReadIsShort({ accounts: [], printedRepairs: ["x"] }, summary({}))).toBe(true);
    expect(storedReadIsShort({ accounts: [] }, null)).toBe(false);
  });
});
