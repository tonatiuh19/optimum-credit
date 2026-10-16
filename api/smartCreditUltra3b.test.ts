/**
 * SmartCredit "Ultra 4K 3B" PDF text (Lecca, Oct 2026): a bureau with no file
 * prints "——". Scores must not shift columns, and wins must name the account
 * (by its account-number row), with only the bureaus that reported it.
 */
import { describe, expect, it } from "vitest";
import {
  diffNegativeAccounts,
  extractAllScores,
  extractNegativeAccounts,
  hasSmartCreditAccountLayout,
} from "./index";

const T = "\t";
function report(opts: { tu: string; ex: string; eq: string; accounts: string[] }): string {
  return [
    "Credit Scores",
    "Personal Information",
    "Credit Report Date",
    "Credit Utilization",
    `TransUnion ${T}$2,118 ${T}$5,150 ${T}41%`,
    `Experian ${T}—— ${T}—— ${T}——`,
    `Equifax ${T}$2,118 ${T}$3,000 ${T}71%`,
    "Revolving Accounts",
    "ACME BANK 517805****",
    "Open",
    "Account Number",
    `TransUnion®${T}`,
    `Experian®${T}`,
    "Equifax®",
    `${opts.tu} ${T}${opts.ex} ${T}${opts.eq}`,
    `TransUnion®${T}`,
    `Experian®${T}`,
    "Equifax®",
    `03/11/2026 ${T}10/16/2026 ${T}03/11/2026`,
    ...opts.accounts,
  ].join("\n");
}

const UNIFY_HEAD = ["UNIFY FIN CU 349952****", "Negative Chargeoff Closed On 11/01/2021", "Account Number", "Payment Status"];
const UNIFY_ROWS = [
  `349952**** ${T}—— ${T}——`,
  `$2,037 ${T}—— ${T}——`,
  `Derogatory ${T}—— ${T}——`,
  `Collection/Chargeoff ${T}—— ${T}——`,
  "Charged off as bad debt",
];
const JPM_HEAD = ["JPMCB CARD 414720****", "Negative Chargeoff Closed On 05/19/2019", "Account Number"];
const JPM_ROWS = [
  `414720**** ${T}—— ${T}414720****`,
  `TransUnion 30: 0 60: 0 90: 0 ${T}Experian ${T}30: –– 60: –– 90: ––`,
  `Collection/Chargeoff ${T}—— ${T}Collection/Chargeoff`,
  `Canceled by credit grantor —— ${T}Charged off account`,
];
const ACME_ROWS = [`517805**** ${T}—— ${T}517805****`, `Late 30 Days ${T}—— ${T}Late 30 Days`];
const ACME_CLEAN = [`517805**** ${T}—— ${T}517805****`, `Pays as agreed ${T}—— ${T}Pays as agreed`];

describe("SmartCredit Ultra 3B — missing bureau column", () => {
  it("scores keep their columns when Experian is ——", () => {
    expect(extractAllScores(report({ tu: "638", ex: "——", eq: "631", accounts: [] }))).toEqual({
      transunion: 638,
      experian: null,
      equifax: 631,
    });
    expect(extractAllScores(report({ tu: "——", ex: "702", eq: "690", accounts: [] }))).toEqual({
      transunion: null,
      experian: 702,
      equifax: 690,
    });
  });

  it("all three scores present still map in order", () => {
    expect(extractAllScores(report({ tu: "640", ex: "650", eq: "660", accounts: [] }))).toEqual({
      transunion: 640,
      experian: 650,
      equifax: 660,
    });
  });

  it("wins name the account (heading may be pages before its rows) with real bureaus", () => {
    // Value rows of UNIFY follow the ACME heading block (page layout), so the
    // account-number row — not the nearest heading — identifies the account.
    const before = report({
      tu: "634", ex: "——", eq: "592",
      accounts: [...UNIFY_HEAD, ...JPM_HEAD, ...ACME_CLEAN, ...UNIFY_ROWS, ...JPM_ROWS],
    });
    const after = report({
      tu: "638", ex: "——", eq: "631",
      accounts: [...UNIFY_HEAD, ...ACME_ROWS],
    });
    expect(hasSmartCreditAccountLayout(before)).toBe(true);
    const b = extractNegativeAccounts(before);
    expect(b.map((x) => [x.label, x.bureaus])).toEqual([
      ["UNIFY FIN CU — Collection/Chargeoff", ["TU"]],
      ["JPMCB CARD — Collection/Chargeoff", ["TU", "EQ"]],
    ]);
    const a = extractNegativeAccounts(after);
    expect(a.map((x) => [x.label, x.bureaus])).toEqual([["ACME BANK — Late 30 Days", ["TU", "EQ"]]]);
    const { removed } = diffNegativeAccounts(b, a);
    expect(removed.map((x) => x.label)).toEqual([
      "UNIFY FIN CU — Collection/Chargeoff",
      "JPMCB CARD — Collection/Chargeoff",
    ]);
  });

  it("an account still negative after (renamed heading) is NOT a win", () => {
    const before = report({ tu: "600", ex: "——", eq: "610", accounts: [...JPM_HEAD, ...JPM_ROWS, "UNIFY X 349952****"] });
    const after = report({
      tu: "600", ex: "——", eq: "610",
      accounts: ["JPMCB CARD SERVICES 414720****", "UNIFY X 349952****", ...JPM_ROWS],
    });
    expect(diffNegativeAccounts(extractNegativeAccounts(before), extractNegativeAccounts(after)).removed).toEqual([]);
  });
});

describe("win labels must name a real creditor (all layouts)", () => {
  it("rejects column rows, bare statuses and category-only names", async () => {
    const { isCreditorlessWinLabel } = await import("./index");
    for (const junk of [
      "Collection/Chargeoff \t—— \t——",
      "Derogatory \tDerogatory \tDerogatory",
      "Paid \tPaid",
      "Negative — Charge-Off",
      "Negative Closed",
      "Collection/Chargeoff",
      "Other",
      "Open — Late Payment",
      "Open Sales Financing — Late Payment",
      "Credit Card Negative Closed",
      "Charged off as bad debt",
      "Amount in high credit original",
    ]) {
      expect(isCreditorlessWinLabel(junk), junk).toBe(true);
    }
    for (const real of [
      "UNIFY FIN CU — Collection/Chargeoff",
      "CAPITAL ONE — Charge-off",
      "SYNCB/NTWK — Late 60 Days",
      "Chapter 7 — Bankruptcy",
      "Collection: Capital One $412",
      "PORTFOLIO RC",
    ]) {
      expect(isCreditorlessWinLabel(real), real).toBe(false);
    }
  });

  it("mixed layouts: an account still on the After report is never a win", async () => {
    const { mergeRemovedWins } = await import("./index");
    // Before = SmartCredit (account-number keys), After = another provider
    // (creditor|type keys): match by creditor name instead.
    const before = extractNegativeAccounts(
      report({ tu: "600", ex: "——", eq: "610", accounts: [...JPM_HEAD, ...UNIFY_HEAD, ...JPM_ROWS, ...UNIFY_ROWS] }),
    );
    const afterOther = [
      { key: "jpmccard|chargeoff", label: "JPMCB CARD — Charge-Off", creditor: "JPMCB CARD", type: "Charge-Off", bureaus: ["TU"] as ("TU" | "EX" | "EQ")[] },
    ];
    const { removed } = diffNegativeAccounts(before, afterOther);
    const wins = mergeRemovedWins(removed, ["JPMCB CARD charge off 2019", "- Negative Closed"], afterOther);
    expect(wins.map((w) => w.label)).toEqual(["UNIFY FIN CU — Collection/Chargeoff"]);
  });
});
