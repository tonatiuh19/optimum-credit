/**
 * One creditor name, two accounts: a clean card (oldest account → "credit
 * history since …" positive) and a card with lates (dispute target). The
 * positives self-check compares accounts (creditor + last 4), not names, and
 * the client copy names each card. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile } from "./creditFile";
import { pv2Diff, pv2SameAccountKey } from "./progressReportV2";

const tl = (over: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null,
  dateReported: null, dateOpened: null, balance: 0, closedDate: null, accountRating: null,
  description: null, disputeStatus: null, creditorType: null, accountStatus: "Closed",
  paymentStatus: "Pays as Agreed", remarks: null, paymentAmount: null, lastPayment: null,
  termLength: null, pastDue: 0, accountType: "Credit Card", paymentFrequency: null, creditLimit: 500,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...over,
});
const all3 = (t: BureauTradeline): Partial<Record<Bureau, BureauTradeline>> => ({ TU: { ...t }, EX: { ...t }, EQ: { ...t } });
const acct = (creditor: string, mask: string, bureaus: Partial<Record<Bureau, BureauTradeline>>): CreditAccount => ({
  creditor, mask, section: "revolving", headerStatus: null, bureaus, confident: true,
});
const file = (reportDate: string, accounts: CreditAccount[]): CreditFile => ({
  provider: "smartcredit", reportDate, scores: { TU: 520, EX: 522, EQ: 544 }, accounts, inquiries: [],
  publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
});

const clean = (mask: string) => acct("STORE CARD BANK", mask, all3(tl({ dateOpened: "02/01/2017", closedDate: "02/01/2019" })));
const late = (mask: string) => acct("STORE CARD BANK", mask, all3(tl({ dateOpened: "09/01/2021", closedDate: "05/01/2025", late30: 3, late60: 1, late90: 1 })));
const other = acct("OTHER LENDER", "7777", all3(tl({ dateOpened: "03/01/2019", accountStatus: "Open", creditLimit: 2000 })));

describe("shared creditor name: clean card in Positives, late card in Targets", () => {
  const cases: Array<[string, CreditAccount[], boolean]> = [
    ["clean ...8030 oldest, late ...1884 target → no conflict", [clean("****8030"), late("****1884"), other], false],
    ["only the late card exists → never a positive", [late("****1884"), other], false],
    ["no last 4 on either card → treated as the same account (conservative)", [clean(""), late(""), other], true],
  ];
  for (const [name, accounts, conflict] of cases) {
    it(name, () => {
      const d = pv2Diff(file("07/23/2026", accounts), file("10/20/2026", accounts), "en");
      const hits = (d.positiveAccountKeys ?? []).filter((k) => (d.targetAccountKeys ?? []).some((t) => pv2SameAccountKey(k, t)));
      expect(hits.length > 0).toBe(conflict);
      if (!conflict && accounts.some((a) => a.mask === "****8030")) {
        expect(d.positives).toContain("Credit history dating back to 2017 (STORE CARD BANK, acct ending 8030).");
        const t = d.targets.find((x) => /STORE CARD BANK/.test(x.item))!;
        expect(t.item).toBe("STORE CARD BANK (acct ending 1884) - Late payments");
      }
    });
  }
  it("a single account under its name keeps the plain label", () => {
    const d = pv2Diff(file("07/23/2026", [clean("****8030"), other]), file("10/20/2026", [clean("****8030"), other]), "en");
    expect(d.positives).toContain("Credit history dating back to 2017 (STORE CARD BANK).");
  });
});

// ── One account split across rows (a bureau prints no account number) ───────
import { consolidateSplitAccounts } from "./creditFileExtract";
import { pv2DistinguishingTag } from "./progressReportV2";

describe("consolidateSplitAccounts: one tradeline printed in two rows", () => {
  const row = (mask: string | null, bureaus: Bureau[], o: Partial<BureauTradeline> = {}, creditor = "JEWELRY STORE"): CreditAccount => ({
    creditor, mask, section: "revolving", headerStatus: null, confident: true,
    bureaus: Object.fromEntries(bureaus.map((b) => [b, tl({ accountStatus: "Open", paymentStatus: "Late 30 Days", dateOpened: "Oct 01, 2023", balance: 823, creditLimit: 2300, late30: 1, ...o })])),
  });
  it.each([
    ["no number on one bureau (EQ/TU + EX)", [row("01", ["EQ", "TU"]), row(null, ["EX"])], 1],
    ["same number, other bureau", [row("****1234", ["TU"]), row("1234", ["EX", "EQ"])], 1],
    ["short number is the tail of the long one", [row("01", ["TU"]), row("****8801", ["EX"])], 1],
    ["only the limit is printed on both, balance missing on one", [row(null, ["TU"], { balance: null }), row("55", ["EX"])], 1],
    ["MM/YYYY vs 'Mon DD, YYYY' open dates", [row(null, ["TU"], { dateOpened: "10/2023" }), row("01", ["EX"])], 1],
    ["different numbers", [row("1111", ["TU"]), row("2222", ["EX"])], 2],
    ["different open month", [row(null, ["TU"]), row("01", ["EX"], { dateOpened: "Nov 01, 2023" })], 2],
    ["limit contradicts", [row(null, ["TU"]), row("01", ["EX"], { creditLimit: 500 })], 2],
    ["balance contradicts", [row(null, ["TU"]), row("01", ["EX"], { balance: 100 })], 2],
    ["shared bureau (two real accounts)", [row(null, ["TU", "EX"]), row("01", ["EX"])], 2],
    ["no open date", [row(null, ["TU"], { dateOpened: null }), row("01", ["EX"], { dateOpened: null })], 2],
    ["no amount to compare", [row(null, ["TU"], { balance: 0, creditLimit: null }), row("01", ["EX"], { balance: 0, creditLimit: null })], 2],
    ["other creditor", [row(null, ["TU"]), row("01", ["EX"], {}, "OTHER STORE")], 2],
  ] as Array<[string, CreditAccount[], number]>)("%s → %s account(s)", (_n, rows, n) => {
    const bureausIn = rows.reduce((s, r) => s + BUREAUS_OF(r).length, 0);
    const out = consolidateSplitAccounts(rows);
    expect(out).toHaveLength(n);
    if (n === 1) {
      expect(BUREAUS_OF(out[0]).length).toBe(bureausIn);
      // The row with an account number keeps it.
      if (rows.some((r) => r.mask)) expect(out[0].mask).toBeTruthy();
    }
  });
  it("merged split account → one target, limits counted once", () => {
    const accounts = [row("01", ["EQ", "TU"]), row(null, ["EX"]), other];
    const d = pv2Diff(file("07/23/2026", consolidateSplitAccounts(accounts.map((a) => ({ ...a, bureaus: { ...a.bureaus } })))), file("10/20/2026", consolidateSplitAccounts(accounts.map((a) => ({ ...a, bureaus: { ...a.bureaus } })))), "en");
    expect(d.targets.filter((t) => /JEWELRY STORE/.test(t.item))).toHaveLength(1);
  });
});
const BUREAUS_OF = (a: CreditAccount) => (["TU", "EX", "EQ"] as Bureau[]).filter((b) => a.bureaus[b]);

describe("pv2DistinguishingTag: every same-name group gets unique labels", () => {
  const T = { endingIn: (l: string) => `acct ending ${l}`, opened: (d: string) => `opened ${d}`, limitTag: (m: string) => `${m} limit` } as never;
  const a = (mask: string | null, o: Partial<BureauTradeline>, bureaus: Bureau[] = ["TU"]): CreditAccount => ({
    creditor: "X", mask, section: "revolving", headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(o)])),
  });
  it.each([
    ["account numbers", [a("1111", {}), a("2222", {})], ["acct ending 1111", "acct ending 2222"]],
    ["no numbers → open month", [a(null, { dateOpened: "01/2020" }), a(null, { dateOpened: "06/2022" })], ["opened 01/2020", "opened 06/2022"]],
    ["one number missing → open month", [a("1111", { dateOpened: "01/2020" }), a(null, { dateOpened: "06/2022" })], ["opened 01/2020", "opened 06/2022"]],
    ["same month → limit", [a(null, { dateOpened: "01/2020", creditLimit: 500 }), a(null, { dateOpened: "01/2020", creditLimit: 900 })], ["$500 limit", "$900 limit"]],
    ["same month + limit → balance", [a(null, { dateOpened: "01/2020", creditLimit: 500, balance: 10 }), a(null, { dateOpened: "01/2020", creditLimit: 500, balance: 20 })], ["$10", "$20"]],
    ["all equal but bureaus differ", [a(null, { dateOpened: "01/2020" }, ["TU"]), a(null, { dateOpened: "01/2020" }, ["EX", "EQ"])], ["TU", "EX/EQ"]],
    ["identical → numbered", [a(null, {}), a(null, {})], ["#1", "#2"]],
    ["three accounts, two share a month → limit", [a(null, { dateOpened: "01/2020", creditLimit: 1 }), a(null, { dateOpened: "01/2020", creditLimit: 2 }), a(null, { dateOpened: "03/2020", creditLimit: 3 })], ["$1 limit", "$2 limit", "$3 limit"]],
  ] as Array<[string, CreditAccount[], string[]]>)("%s", (_n, accts, tags) => {
    const tagOf = pv2DistinguishingTag(accts, T);
    expect(accts.map((_, i) => tagOf(i))).toEqual(tags);
  });
});
