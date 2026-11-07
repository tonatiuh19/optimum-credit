/**
 * Self-check account totals (Oct 29, 2026 — a client R5): a complete SmartCredit PDF listed
 * 25 Equifax accounts (two look-alike Capital One cards) under its own "24" summary, and
 * the exact-match rule held an accurate report. Missing accounts still always fail (they
 * would look "removed"); a small over-count passes with a note unless a negative account
 * is doubled (a double read would duplicate a target).
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import {
  PV2_SUMMARY_PARSER_VERSION,
  pv2AccountCountVerdict,
  pv2BuildPdfData,
  pv2Diff,
  pv2SelfCheck,
  type Pv2PullSummary,
  type Pv2RenderStats,
} from "./progressReportV2";

const B: Bureau[] = ["TU", "EX", "EQ"];
const tl = (o: Partial<BureauTradeline> = {}): BureauTradeline =>
  ({ dateOpened: "06/01/2014", balance: 0, creditLimit: 500, accountStatus: "Closed", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [], ...o }) as BureauTradeline;
const acct = (creditor: string, mask: string, bureaus: Partial<Record<Bureau, BureauTradeline>>, section: CreditAccount["section"] = "revolving"): CreditAccount =>
  ({ creditor, mask, section, headerStatus: null, confident: true, bureaus }) as CreditAccount;
const file = (date: string, accounts: CreditAccount[]): CreditFile =>
  ({ provider: "smartcredit", reportDate: date, scores: { TU: 600, EX: 600, EQ: 600 }, accounts, inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 20, confidence: 1, warnings: [] }) as unknown as CreditFile;
const summary = (counts: Partial<Record<Bureau, number>>, kind: "total" | "open" = "total"): Pv2PullSummary =>
  ({
    parserVersion: PV2_SUMMARY_PARSER_VERSION,
    format: "smartcredit",
    reportDate: null,
    perBureau: Object.fromEntries(
      B.map((b) => [b, counts[b] == null ? null : { totalAccounts: kind === "total" ? counts[b] : null, openAccounts: kind === "open" ? counts[b] : null, closedAccounts: null, balances: null, publicRecords: null, inquiries2y: null }]),
    ),
    revolving: { TU: null, EX: null, EQ: null },
  }) as Pv2PullSummary;

/** n clean open accounts on EQ only. */
const clean = (n: number) => Array.from({ length: n }, (_, i) => acct(`LENDER ${i}`, String(1000 + i), { EQ: tl({ accountStatus: "Open", dateOpened: `0${(i % 9) + 1}/01/2015` }) }));
// a client: two different closed Capital One cards, same BIN prefix + open month.
const capOnePair = () => [acct("CAP ONE", "517805", { EQ: tl() }), acct("CAP ONE", "517805", { EQ: tl() })];
const late = (o: Partial<BureauTradeline> = {}) => acct("BAD BANK", "4444", { EQ: tl({ accountStatus: "Open", paymentStatus: "Late 30 Days", late30: 2, dateOpened: "01/01/2020", ...o }) });

describe("pv2AccountCountVerdict", () => {
  it.each([
    ["exact match", clean(24), 24, 24, "ok"],
    ["one missing → fail (could look removed)", clean(23), 23, 24, "fail"],
    ["many missing → fail", clean(16), 16, 24, "fail"],
    ["one extra, look-alike closed cards → note", [...clean(23), ...capOnePair()], 25, 24, "note"],
    ["over-count beyond the tolerance → fail", clean(27), 27, 24, "fail"],
    ["3% of a large file is tolerated (+2 on 60)", clean(62), 62, 60, "note"],
    ["…but not more (+3 on 60)", clean(63), 63, 60, "fail"],
    ["one extra where a negative account is doubled → fail (double read)", [...clean(23), late(), late()], 25, 24, "fail"],
    ["one extra with two different negatives → note", [...clean(23), late(), late({ dateOpened: "05/01/2021" })], 25, 24, "note"],
  ] as Array<[string, CreditAccount[], number, number, string]>)("%s", (_n, accounts, got, want, verdict) => {
    expect(pv2AccountCountVerdict(accounts, "EQ", got, want)).toBe(verdict);
  });

  it("masks with asterisks and creditor spellings still match as a doubled negative", () => {
    const a = acct("Bad Bank, N.A.", "4444****", { EQ: tl({ accountStatus: "Open", late30: 1 }) });
    const b = acct("BAD BANK NA", "4444", { EQ: tl({ accountStatus: "Open", late30: 1 }) });
    expect(pv2AccountCountVerdict([...clean(10), a, b], "EQ", 12, 11)).toBe("fail");
  });
});

describe("pv2SelfCheck account_totals", () => {
  const run = (before: CreditFile, after: CreditFile, sb: Pv2PullSummary | null, sa: Pv2PullSummary | null) => {
    const diff = pv2Diff(before, after);
    const scores = { TU: { before: 600, after: 610 }, EX: { before: 600, after: 610 }, EQ: { before: 600, after: 610 } } as Record<Bureau, { before: number; after: number }>;
    const pdf = pv2BuildPdfData({ diff, clientFirstName: "A", clientName: "A B", round: 5, scores, phone: "x", site: "x" });
    const stats: Pv2RenderStats = { targetsRepresented: diff.targets.length, winsRepresented: diff.wins.length, pages: 3, croaText: "", clientText: [] };
    return pv2SelfCheck({ before, after, summaries: { before: sb, after: sa }, diff, pdf, stats, recordTargets: diff.targets.length }).checks.find((c) => c.key === "account_totals")!;
  };
  const before = () => file("06/24/2026", [...clean(23), ...capOnePair()]);

  it("a client R5: After lists one more Equifax account than its summary → passes, with the reason shown", () => {
    const c = run(before(), file("10/26/2026", [...clean(23), ...capOnePair()]), summary({ EQ: 25 }), summary({ EQ: 24 }));
    expect(c.pass).toBe(true);
    expect(c.detail).toBe("After EQ: 25 accounts read, summary 24 (the report lists more than its own summary; no account missing)");
  });

  it("half-loaded After (accounts missing) still fails and is named", () => {
    const c = run(before(), file("10/26/2026", clean(16)), summary({ EQ: 25 }), summary({ EQ: 24 }));
    expect(c.pass).toBe(false);
    expect(c.detail).toBe("After EQ: 16 accounts read, summary 24");
  });

  it("a doubled negative on the After still fails", () => {
    const c = run(before(), file("10/26/2026", [...clean(23), late(), late()]), summary({ EQ: 25 }), summary({ EQ: 24 }));
    expect(c.pass).toBe(false);
  });

  it("a failure on one pull is not hidden by a note on the other", () => {
    const c = run(file("06/24/2026", clean(20)), file("10/26/2026", [...clean(23), ...capOnePair()]), summary({ EQ: 25 }), summary({ EQ: 24 }));
    expect(c.pass).toBe(false);
    expect(c.detail).toBe("Before EQ: 20 accounts read, summary 25");
  });

  it("exact matches keep the usual detail", () => {
    const c = run(before(), file("10/26/2026", [...clean(23), ...capOnePair()]), summary({ EQ: 25 }), summary({ EQ: 25 }));
    expect(c).toMatchObject({ pass: true, detail: "matches the pull summary" });
  });

  it("open-account layouts (MyFreeScoreNow) follow the same rule", () => {
    const openPair = [acct("CAP ONE", "517805", { EQ: tl({ accountStatus: "Open" }) }), acct("CAP ONE", "517805", { EQ: tl({ accountStatus: "Open" }) })];
    const ok = run(before(), file("10/26/2026", [...clean(23), ...openPair]), null, summary({ EQ: 24 }, "open"));
    expect(ok.pass).toBe(true);
    expect(ok.detail).toMatch(/25 open accounts read, summary 24 \(the report lists more/);
    const short = run(before(), file("10/26/2026", clean(20)), null, summary({ EQ: 24 }, "open"));
    expect(short.pass).toBe(false);
  });
});

describe("over-count can never hide a missing account (open / closed split)", () => {
  // a client real Equifax split: summary 24 = 13 open + 11 closed; read 13 open + 12 closed.
  const openN = (n: number, tag: string) => Array.from({ length: n }, (_, i) => acct(`OPEN ${tag}${i}`, String(3000 + i), { EQ: tl({ accountStatus: "Open", dateOpened: `0${(i % 9) + 1}/01/2016` }) }));
  const closedN = (n: number, tag: string) => Array.from({ length: n }, (_, i) => acct(`CLOSED ${tag}${i}`, String(5000 + i), { EQ: tl({ dateOpened: `0${(i % 9) + 1}/01/2012` }) }));
  const split = { open: 13, closed: 11 };

  it("a client: extra closed look-alike, open complete → note", () => {
    const accts = [...openN(13, "a"), ...closedN(10, "a"), ...capOnePair()];
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24, split)).toBe("note");
  });

  it("a doubled closed card + a missing open late account (net +1) → fail", () => {
    // 12 open (one late account missing) + 11 closed + 2 copies of the same closed card = 25.
    const dupClosed = acct("DUP CARD", "7777", { EQ: tl({ dateOpened: "02/01/2011" }) });
    const accts = [...openN(12, "b"), ...closedN(11, "b"), dupClosed, { ...dupClosed }];
    expect(accts.length).toBe(25);
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24)).toBe("note"); // totals alone cannot see it
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24, split)).toBe("fail"); // the split can
  });

  it("closed category short while open is long → fail", () => {
    const accts = [...openN(15, "c"), ...closedN(10, "c")];
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24, split)).toBe("fail");
  });

  it("a summary that prints only one side of the split checks that side", () => {
    const accts = [...openN(12, "d"), ...closedN(13, "d")];
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24, { open: 13, closed: null })).toBe("fail");
    expect(pv2AccountCountVerdict(accts, "EQ", 25, 24, { open: null, closed: 11 })).toBe("note");
  });

  it("self-check wires the printed split in", () => {
    const sum = (total: number, open: number, closed: number) =>
      ({ ...summary({ EQ: total }), perBureau: { TU: null, EX: null, EQ: { totalAccounts: total, openAccounts: open, closedAccounts: closed, balances: null, publicRecords: null, inquiries2y: null } } }) as Pv2PullSummary;
    const dupClosed = acct("DUP CARD", "7777", { EQ: tl({ dateOpened: "02/01/2011" }) });
    const before = file("06/24/2026", [...openN(13, "e"), ...closedN(11, "e")]);
    const after = file("10/26/2026", [...openN(12, "e"), ...closedN(11, "e"), dupClosed, { ...dupClosed }]);
    const diff = pv2Diff(before, after);
    const scores = { TU: { before: 600, after: 610 }, EX: { before: 600, after: 610 }, EQ: { before: 600, after: 610 } } as Record<Bureau, { before: number; after: number }>;
    const pdf = pv2BuildPdfData({ diff, clientFirstName: "A", clientName: "A B", round: 5, scores, phone: "x", site: "x" });
    const stats: Pv2RenderStats = { targetsRepresented: diff.targets.length, winsRepresented: diff.wins.length, pages: 3, croaText: "", clientText: [] };
    const c = pv2SelfCheck({ before, after, summaries: { before: sum(24, 13, 11), after: sum(24, 13, 11) }, diff, pdf, stats, recordTargets: diff.targets.length }).checks.find((x) => x.key === "account_totals")!;
    expect(c).toMatchObject({ pass: false, detail: "After EQ: 25 accounts read, summary 24" });
  });
});

