/**
 * Nov 12, 2026 — a bureau can really list one account twice and count both in its own summary
 * (Equifax printed one card twice: same last 4, same balance). Merging them made the self-check
 * fail on every round built on that pull. The pull's per-bureau totals now decide.
 * No client data here.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import { normalizeStoredRead, type PrintedBureauTotals } from "./creditFileExtract";

const tl = (o: Partial<BureauTradeline> = {}): BureauTradeline =>
  ({ dateOpened: "12/01/2022", balance: 2367, creditLimit: 0, highBalance: null, accountStatus: "Closed", paymentStatus: "Collection/Chargeoff", accountType: "Credit Card", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [], ...o }) as BureauTradeline;
const acct = (creditor: string, mask: string | null, bureaus: Bureau[], t: Partial<BureauTradeline> = {}): CreditAccount =>
  ({ creditor, mask, section: "revolving", headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(t)])) }) as CreditAccount;
const other = (n: number, bureaus: Bureau[] = ["TU", "EX", "EQ"]) =>
  acct(`LENDER ${n}`, String(1000 + n), bureaus, { balance: 0, paymentStatus: "Current", dateOpened: `0${(n % 9) + 1}/01/2019` });
const file = (accounts: CreditAccount[]) => ({ provider: "smartcredit", reportFormat: "per_bureau", accounts, inquiries: [] }) as unknown as CreditFile;
const totals = (t: Partial<Record<Bureau, number>>): PrintedBureauTotals => ({
  perBureau: Object.fromEntries(Object.entries(t).map(([b, n]) => [b, { totalAccounts: n }])) as PrintedBureauTotals["perBureau"],
});
const eq = (f: CreditFile) => f.accounts.filter((a) => a.bureaus.EQ).length;
const tu = (f: CreditFile) => f.accounts.filter((a) => a.bureaus.TU).length;

// The real shape: a 3-bureau card plus the same card again on Equifax only, shortened name.
const card = () => acct("ALLY CREDIT CARD/CWS", "3993", ["TU", "EX", "EQ"]);
const eqTwin = () => acct("ALLY CREDI", "3993", ["EQ"]);
const rest = () => [other(1), other(2), other(3)];

describe("summary-aware merge of same-bureau twins", () => {
  it("keeps both when the bureau's own total counts both (the Nov 12 case)", () => {
    const out = normalizeStoredRead(file([card(), ...rest(), eqTwin()]), totals({ EQ: 5, TU: 4, EX: 4 }));
    expect(eq(out)).toBe(5);
    expect(out.accounts.filter((a) => /ALLY/.test(a.creditor))).toHaveLength(2);
  });

  it("still merges when the bureau's total counts it once (MyFreeScoreNow-style name pair)", () => {
    const out = normalizeStoredRead(file([card(), ...rest(), eqTwin()]), totals({ EQ: 4, TU: 4, EX: 4 }));
    expect(eq(out)).toBe(4);
  });

  it("without a printed total nothing changes (merged as before)", () => {
    expect(eq(normalizeStoredRead(file([card(), ...rest(), eqTwin()])))).toBe(4);
    expect(eq(normalizeStoredRead(file([card(), ...rest(), eqTwin()]), { perBureau: null }))).toBe(4);
  });

  it("identical row read twice (rule C) is kept when the total says two, merged when it says one", () => {
    const loan = (b: Bureau[]) => acct("LOAN SERVICER", "77", b, { balance: 5000, paymentStatus: "Current", accountStatus: "Open" });
    expect(eq(normalizeStoredRead(file([loan(["EQ"]), loan(["EQ"])]), totals({ EQ: 2 })))).toBe(2);
    expect(eq(normalizeStoredRead(file([loan(["EQ"]), loan(["EQ"])]), totals({ EQ: 1 })))).toBe(1);
  });

  it("never trades one bureau for another: stays merged if keeping twins overshoots a bureau", () => {
    // Twin pair on TU+EQ, but only EQ is short: keeping it would push TU over its total.
    const a = acct("CARD CO", "55", ["TU", "EQ"]);
    const b = acct("CARD CO", "55", ["TU", "EQ"]);
    const out = normalizeStoredRead(file([a, b, other(1)]), totals({ TU: 2, EQ: 3 }));
    expect(tu(out)).toBe(2);
    expect(eq(out)).toBe(2);
  });

  it("does not touch split rows across bureaus (one account read as two rows stays one)", () => {
    const tuRow = acct("BANK X", "4321", ["TU"], { balance: 900, paymentStatus: "Current" });
    const eqRow = acct("BANK X", "4321", ["EQ"], { balance: 900, paymentStatus: "Current" });
    const out = normalizeStoredRead(file([tuRow, eqRow]), totals({ TU: 1, EQ: 1 }));
    expect(out.accounts).toHaveLength(1);
  });

  it("a read that is short for another reason is left as merged (no gain from keeping twins)", () => {
    const out = normalizeStoredRead(file([card(), ...rest()]), totals({ EQ: 7 }));
    expect(eq(out)).toBe(4);
  });

  it("does not mutate the input file", () => {
    const f = file([card(), ...rest(), eqTwin()]);
    const before = JSON.stringify(f);
    normalizeStoredRead(f, totals({ EQ: 5 }));
    expect(JSON.stringify(f)).toBe(before);
  });
});
