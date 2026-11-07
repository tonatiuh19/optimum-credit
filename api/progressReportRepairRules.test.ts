/**
 * Rules every printed-fact repair must obey, on thousands of generated reports (Nov 7, 2026 — after
 * a client: a repair changed Experian without fixing it, and two cards took one printed value).
 * Synthetic data only. fast-check shrinks any failure to the smallest report that breaks a rule.
 *
 * Generated: a "true" report (what the PDF prints) → its printed blocks (some missing) and totals,
 * and a read of it with mistakes (wrong limits / balances, duplicated cards, missing bureaus).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, ScPrintedLimit } from "./creditFile";
import { isClosedTradeline } from "./creditAnalysisFromFile";
import { pv2ApplyPrintedFacts, pv2RepairsEnabled, type Pv2PullSummary } from "./progressReportV2";

const BUREAUS: Bureau[] = ["TU", "EX", "EQ"];
const RUNS = Number(process.env.REPAIR_RULE_RUNS || 1500);

const tl = (o: Partial<BureauTradeline>): BureauTradeline =>
  ({ accountStatus: "Open", balance: 0, creditLimit: 0, dateOpened: "01/01/2020", late30: 0, late60: 0, late90: 0, ...o }) as BureauTradeline;

// Few creditors / numbers so look-alikes (same creditor + number) are common.
const arbTrueAccount = fc.record({
  creditor: fc.constantFrom("CAPITAL ONE", "AMEX", "BANK A"),
  number: fc.constantFrom("517805", "515676", "349993"),
  section: fc.constantFrom("revolving", "revolving", "revolving", "installment", "unknown") as fc.Arbitrary<CreditAccount["section"]>,
  closed: fc.boolean(),
  opened: fc.constantFrom("01/01/2019", "06/01/2021", "03/01/2023"),
  bureaus: fc.subarray(BUREAUS, { minLength: 1 }),
  limit: fc.constantFrom(300, 500, 1000, 1250, 4000, 10000),
  balance: fc.constantFrom(0, 37, 101, 999, 1965),
});

const arbCase = fc.record({
  truth: fc.array(arbTrueAccount, { minLength: 1, maxLength: 7 }),
  // Per true account: printed block missing? read mistakes?
  noise: fc.array(
    fc.record({
      blockMissing: fc.boolean(),
      wrongLimit: fc.option(fc.constantFrom(300, 1000, 1279, 4000, 9000), { nil: undefined }),
      wrongBalance: fc.option(fc.constantFrom(0, 50, 4513), { nil: undefined }),
      duplicated: fc.boolean(),
      dropBureau: fc.boolean(),
    }),
    { minLength: 7, maxLength: 7 },
  ),
  totalsOff: fc.option(fc.constantFrom(-3000, 700, 5000), { nil: undefined }),
  hasBalanceTotals: fc.boolean(),
});

type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

function build(c: Case): { read: CreditFile; summary: Pv2PullSummary } {
  const printed: ScPrintedLimit[] = [];
  const readAccounts: CreditAccount[] = [];
  const revolving: Record<Bureau, { used: number; limit: number } | null> = { TU: null, EX: null, EQ: null };
  const balances: Record<Bureau, number> = { TU: 0, EX: 0, EQ: 0 };
  c.truth.forEach((t, i) => {
    const n = c.noise[i];
    const status = t.closed ? "Closed" : "Open";
    if (!n.blockMissing) {
      printed.push({
        creditor: t.creditor,
        mask: `${t.number}****`,
        section: t.section,
        limits: Object.fromEntries(t.bureaus.map((b) => [b, t.limit])),
        balances: Object.fromEntries(t.bureaus.map((b) => [b, t.balance])),
        opened: Object.fromEntries(t.bureaus.map((b) => [b, t.opened])),
      });
    }
    for (const b of t.bureaus) {
      if (t.section === "revolving" && !t.closed) revolving[b] = { used: 0, limit: (revolving[b]?.limit ?? 0) + t.limit };
      balances[b] += t.balance;
    }
    const bureaus = n.dropBureau && t.bureaus.length > 1 ? t.bureaus.slice(1) : t.bureaus;
    const acct: CreditAccount = {
      creditor: t.creditor,
      mask: t.number.slice(-4),
      section: t.section,
      headerStatus: null,
      confident: true,
      bureaus: Object.fromEntries(
        bureaus.map((b, k) => [b, tl({ accountStatus: status, dateOpened: t.opened, creditLimit: k === 0 && n.wrongLimit !== undefined ? n.wrongLimit : t.limit, balance: k === 0 && n.wrongBalance !== undefined ? n.wrongBalance : t.balance })]),
      ),
    };
    readAccounts.push(acct);
    if (n.duplicated) readAccounts.push({ ...acct, mask: t.number.slice(0, 4), bureaus: { ...acct.bureaus } });
  });
  if (c.totalsOff !== undefined) for (const b of BUREAUS) if (revolving[b]) revolving[b] = { used: 0, limit: Math.max(0, revolving[b]!.limit + c.totalsOff) };
  const summary = {
    format: "smartcredit",
    perBureau: Object.fromEntries(BUREAUS.map((b) => [b, c.hasBalanceTotals ? { totalAccounts: null, openAccounts: null, closedAccounts: null, balances: balances[b], publicRecords: null, inquiries2y: null } : null])),
    revolving,
    printedLimits: printed,
  } as unknown as Pv2PullSummary;
  const read = { provider: "smartcredit", reportDate: "10/01/2026", scores: { TU: 600, EX: 600, EQ: 600 }, accounts: readAccounts, inquiries: [] } as unknown as CreditFile;
  return { read, summary };
}

const limitSum = (f: CreditFile, b: Bureau) =>
  f.accounts.filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)).reduce((n, a) => n + (a.bureaus[b]!.creditLimit ?? 0), 0);
const balSum = (f: CreditFile, b: Bureau) => f.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
const limOk = (f: CreditFile, s: Pv2PullSummary, b: Bureau) => {
  const want = s.revolving[b]?.limit;
  return want == null ? null : Math.abs(limitSum(f, b) - want) <= Math.max(50, want * 0.02);
};
const balOk = (f: CreditFile, s: Pv2PullSummary, b: Bureau) => {
  const want = s.perBureau[b]?.balances;
  return want == null ? null : Math.abs(balSum(f, b) - want) <= Math.max(10, want * 0.01);
};
const strip = (f: CreditFile) => JSON.stringify(f.accounts);

describe("printed-fact repair rules (generated reports)", () => {
  it("never breaks a bureau that matched its printed total", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { read, summary } = build(c);
        const out = pv2ApplyPrintedFacts(read, summary);
        for (const b of BUREAUS) {
          if (limOk(read, summary, b) === true) expect(limOk(out, summary, b)).toBe(true);
          if (balOk(read, summary, b) === true) expect(balOk(out, summary, b)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("never changes a bureau's total without making it match (a client Experian)", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { read, summary } = build(c);
        const out = pv2ApplyPrintedFacts(read, summary);
        for (const b of BUREAUS) {
          if (limOk(out, summary, b) === false) expect(limitSum(out, b)).toBe(limitSum(read, b));
          if (balOk(out, summary, b) === false) expect(balSum(out, b)).toBe(balSum(read, b));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("is idempotent, never mutates its input, and the off switch returns the read untouched", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { read, summary } = build(c);
        const before = strip(read);
        const once = pv2ApplyPrintedFacts(read, summary);
        expect(strip(read)).toBe(before);
        expect(strip(pv2ApplyPrintedFacts(once, summary))).toBe(strip(once));
      }),
      { numRuns: RUNS },
    );
    expect(pv2RepairsEnabled({ REPORT_REPAIRS: "off" })).toBe(false);
    expect(pv2RepairsEnabled({ REPORT_REPAIRS: "OFF " })).toBe(false);
    expect(pv2RepairsEnabled({})).toBe(true);
    const prev = process.env.REPORT_REPAIRS;
    process.env.REPORT_REPAIRS = "off";
    try {
      const { read, summary } = build(fc.sample(arbCase, 1)[0]);
      expect(pv2ApplyPrintedFacts(read, summary)).toBe(read);
    } finally {
      if (prev === undefined) delete process.env.REPORT_REPAIRS;
      else process.env.REPORT_REPAIRS = prev;
    }
  });

  it("an account is only ever dropped when an identical copy stays", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { read, summary } = build(c);
        const out = pv2ApplyPrintedFacts(read, summary);
        if (out.accounts.length === read.accounts.length) return;
        // As read (before any value was corrected): each dropped copy has an identical twin that stays.
        const data = (a: CreditAccount) => `${a.creditor}|${JSON.stringify(BUREAUS.map((b) => [a.bureaus[b]?.creditLimit, a.bureaus[b]?.balance, a.bureaus[b]?.dateOpened, a.bureaus[b]?.accountStatus]))}`;
        const kept = new Set(out.accounts.map((o) => `${o.creditor}|${o.mask}`));
        for (const a of read.accounts) {
          if (kept.has(`${a.creditor}|${a.mask}`)) continue;
          expect(read.accounts.some((t) => t !== a && kept.has(`${t.creditor}|${t.mask}`) && data(t) === data(a))).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("one printed block never feeds two cards (a value taken by 2+ cards needs 2+ printed blocks with it)", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { read, summary } = build(c);
        const out = pv2ApplyPrintedFacts(read, summary);
        if (out.accounts.length !== read.accounts.length) return; // a dropped duplicate shifts positions
        for (const b of BUREAUS) {
          const taken = new Map<string, number>();
          out.accounts.forEach((a, i) => {
            const was = read.accounts[i].bureaus[b]?.creditLimit;
            const now = a.bureaus[b]?.creditLimit;
            if (now != null && now !== was) taken.set(`${a.creditor}|${now}`, (taken.get(`${a.creditor}|${now}`) ?? 0) + 1);
          });
          for (const [k, n] of taken) {
            const [creditor, v] = k.split("|");
            const blocks = summary.printedLimits!.filter((p) => p.creditor === creditor && p.limits[b] === Number(v)).length;
            expect(n).toBeLessThanOrEqual(blocks);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
