/**
 * Credit Analysis Fix Spec v2.3 (lender tri-merges, Oct 26 2026) — rules
 * checked over combinations of the conditions that broke them, synthetic files
 * only: repository codes in every order (EXP/TUC/EQX), open/active vs closed /
 * paid / ECOA T / stale, utilization over every revolving line, paid
 * collections, first-derog fallback, accuracy flags (a)–(e), duplicate
 * inquiries, projection rows, bureau coverage gate, and the client PDF (no
 * payoff advice, no truncated values, full name, full enrollment URL).
 */
import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import { maskSsnLike, repositoryBureaus } from "./creditFileExtract";
import { buildCreditAnalysis, derogDateProxy, isInactiveTradeline, PROJECTION_KEYS_MAX } from "./creditAnalysisFromFile";
import { actionPlan, completeValuesOnly, generateOfgCreditAnalysisPdf, generateOfgCreditAnalysisPdfWithMeta, OFG_REPORT_CONTACT } from "./ofgCreditAnalysisPdf";

const B: Bureau[] = ["TU", "EX", "EQ"];
const REPORT = "10/26/2026";
const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: "10/01/2026",
  dateOpened: "01/2021", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
  creditorType: null, accountStatus: "As Agreed", paymentStatus: "As Agreed", remarks: null, paymentAmount: null,
  lastPayment: null, termLength: null, pastDue: 0, accountType: "Rev", paymentFrequency: null, creditLimit: null,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...o,
});
const merged = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Bureau[], o: Partial<BureauTradeline>, extra: Partial<CreditAccount> = {}): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, merged: true,
  bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(o)])), ...extra,
});
const file = (accounts: CreditAccount[], inquiries: CreditInquiry[] = [], extra: Partial<CreditFile> = {}): CreditFile => ({
  provider: "unknown" as never, reportDate: REPORT, scores: { TU: 530, EX: 589, EQ: 559 }, accounts, inquiries,
  publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [], reportFormat: "merged",
  borrowerName: "JANE MARIE DOE SAMPLE", lender: { name: "STATEWIDE", requestedDate: REPORT, requestedBy: "Pat Lender", vendor: "Xactus", reportId: "12345678" },
  ...extra,
});
const program = {
  phone: OFG_REPORT_CONTACT.phone, site: OFG_REPORT_CONTACT.site, standardPrice: "$1,497", complexPrice: "$2,497",
  standardUrl: OFG_REPORT_CONTACT.standardUrl, complexUrl: OFG_REPORT_CONTACT.complexUrl, mfsnUrl: null,
};
const pdfText = async (a: ReturnType<typeof buildCreditAnalysis>) =>
  (await new PDFParse({ data: await generateOfgCreditAnalysisPdf(a, { clientName: "Client", lang: "en", program }) }).getText()).text.replace(/\s+/g, " ");

describe("P0-1/P0-2 repository codes → bureaus (every order and combination)", () => {
  const codes: Record<Bureau, string[]> = { TU: ["TUC", "TU", "TRANSUNION"], EX: ["EXP", "XP", "EXPERIAN"], EQ: ["EQX", "EQ", "EFX", "EQUIFAX"] };
  const subsets = [["EQ"], ["TU", "EQ"], ["EX", "TU"], ["EX", "TU", "EQ"], ["EQ", "TU", "EX"], ["EX"]] as Bureau[][];
  for (const set of subsets)
    for (const sep of ["/", ",", " ", " / "])
      for (let v = 0; v < 3; v++) {
        const raw = set.map((b) => codes[b][Math.min(v, codes[b].length - 1)]).join(sep);
        it(`"${raw}"`, () => expect(repositoryBureaus(raw).sort()).toEqual([...set].sort()));
      }
  it("inquiry 'Reported On' codes (EXP-B1 / TUC-B1 / EQX-B1)", () => {
    expect(repositoryBureaus("EQX-B1")).toEqual(["EQ"]);
    expect(repositoryBureaus("EXP-B1")).toEqual(["EX"]);
    expect(repositoryBureaus("TUC-B1")).toEqual(["TU"]);
  });
  it("blank / unknown → no bureau (never guessed)", () => expect(repositoryBureaus("")).toEqual([]));
});

describe("P0-4 open / active rule", () => {
  const rd = new Date(Date.UTC(2026, 9, 26));
  it.each([
    ["open, reported last month", {}, {}, false],
    ["Closed: MM/YYYY", { closedDate: "06/2024" }, {}, true],
    ["status Paid", { accountStatus: "Paid" }, {}, true],
    ["ECOA T (terminated)", {}, { ecoa: "T" }, true],
    ["last reported 06/2022 (stale)", { dateReported: "06/08/2022" }, {}, true],
    ["reported 5 months ago", { dateReported: "05/20/2026" }, {}, false],
    ["ECOA I (individual)", {}, { ecoa: "I" }, false],
  ] as Array<[string, Partial<BureauTradeline>, Partial<CreditAccount>, boolean]>)("%s → inactive=%s", (_n, t, acct, expected) => {
    const a = merged("CARD", "1111", "revolving", ["TU"], t, acct);
    expect(isInactiveTradeline(a.bureaus.TU!, a, rd)).toBe(expected);
  });
});

// v2.4 #2/#3 (Cesar, Oct 27): utilization counts open cards in good standing only — on tri-merges too.
describe("P0-3 / P0-4 / P0-7 + v2.4 #3 utilization over open cards in good standing, no payoff advice", () => {
  const combos: Array<{ name: string; cards: CreditAccount[]; expectPct: number; goodStanding: boolean; allDerog: boolean }> = [
    {
      name: "charge-off + terminated + closed cards (Laila shape)",
      cards: [
        merged("BANK CARD", "4913", "revolving", B, { balance: 18263, creditLimit: 14700, closedDate: "09/2025", paymentStatus: "Charge Off", accountStatus: "Charge Off", pastDue: 18263 }),
        merged("ISSUER A", "1927", "revolving", ["TU", "EX"], { creditLimit: 7500, dateReported: "06/08/2022" }, { ecoa: "T" }),
        merged("ISSUER B", "9033", "revolving", B, { creditLimit: 20000, closedDate: "09/2023" }),
        merged("ISSUER C", "7430", "revolving", B, { creditLimit: 500, closedDate: "06/2024" }),
      ],
      expectPct: NaN, // no open card in good standing → not applicable (was $18,263 / $42,700)
      goodStanding: false,
      allDerog: true,
    },
    {
      name: "one open card with a balance + a closed card",
      cards: [
        merged("ISSUER A", "1000", "revolving", B, { balance: 600, creditLimit: 1000 }),
        merged("ISSUER B", "2000", "revolving", B, { creditLimit: 1000, closedDate: "01/2024" }),
      ],
      expectPct: 60, // $600 / $1,000 — the closed card's limit no longer counts
      goodStanding: true,
      allDerog: false,
    },
    { name: "no cards at all", cards: [], expectPct: NaN, goodStanding: false, allDerog: false },
  ];
  for (const c of combos) {
    it(c.name, async () => {
      const a = buildCreditAnalysis(file([...c.cards, merged("AUTO LENDER", "5555", "installment", ["TU", "EX"], { accountType: "Inst", balance: 30000, creditLimit: 33000 })]));
      if (Number.isNaN(c.expectPct)) expect(a.utilizationOverall.all).toBeNull();
      else expect(a.utilizationOverall.all).toBeCloseTo(c.expectPct, 1);
      expect(a.utilizationOverall.noOpenCardInGoodStanding).toBe(!c.goodStanding);
      expect(!!a.utilizationOverall.allFromDerogatory).toBe(c.allDerog);
      const text = await pdfText(a);
      const plan = actionPlan(a, false).join(" ");
      for (const t of [text, plan]) expect(t).not.toMatch(/\bbring \S.* to \$|\bor less\b|\bpay (it )?down\b|\bpay off\b|Already OK|Utilization under 10%/i);
      if (c.allDerog) expect(text).toMatch(/addressed through the Round 4 accuracy dispute/);
      if (!c.goodStanding && c.cards.length) expect(text).toMatch(/No open card in good standing - utilization not applicable/);
      for (const p of a.projections) expect(PROJECTION_KEYS_MAX).toContain(p.key);
    });
  }
});

describe("P1-3 / P1-4 / P1-5 negatives: paid collections, first derog date, accuracy flags", () => {
  const accts = [
    merged("COLLECTOR A", "5291", "collection", ["EQ", "TU"], { accountType: "Unkn", balance: 0, creditLimit: 142, closedDate: "10/2026", dateLastActivity: "06/28/2021", dateOpened: "04/10/2023", accountStatus: "Collection", paymentStatus: "Collection", remarks: "CREDITOR: SOME APARTMENTS" }),
    merged("COLLECTOR B", "7052", "collection", B, { accountType: "Inst", balance: 0, creditLimit: 2699, closedDate: "10/2026", dateLastActivity: "09/28/2026", dateOpened: "04/09/2025", accountStatus: "Collection", paymentStatus: "Collection" }),
    merged("LENDER LOAN", "0001", "installment", B, { accountType: "Inst", balance: 0, creditLimit: 520, closedDate: "11/2023", paymentStatus: "90 Days Late", accountStatus: "90 Days Late", late30: 1, late60: 2, late90: 2, gridMarks: ["07/2023:30"] }),
    merged("CARD ISSUER", "9033", "revolving", B, { creditLimit: 20000, closedDate: "09/2023", dateLastActivity: "10/01/2026", late30: 1, late60: 1, late90: 5, gridMarks: ["08/2023:30", "02/2024:90"] }, { highCredit: 21850 }),
    merged("BANK CARD", "4913", "revolving", B, { balance: 18263, creditLimit: 14700, closedDate: "09/2025", paymentStatus: "Charge Off", accountStatus: "Charge Off", pastDue: 18263, gridMarks: ["03/2025:30"] }),
  ];
  const a = buildCreditAnalysis(file(accts));
  const by = (m: string) => a.negatives.find((n) => n.mask === m)!;
  it("paid collections stay negative, Round 2, all bureaus from the code", () => {
    for (const m of ["5291", "7052"]) {
      expect(by(m).round).toBe(2);
      expect(by(m).paidOn).toBe("10/2026");
    }
    expect(by("5291").bureaus.sort()).toEqual(["EQ", "TU"]);
    expect(by("7052").bureaus.sort()).toEqual(["EQ", "EX", "TU"]);
  });
  it("first derog fallback = earlier of DLA and Date Opened, marked as proxy", () => {
    expect(by("5291").derogDate).toBe("06/28/2021");
    expect(by("7052").derogDate).toBe("04/09/2025");
    expect(by("5291").derogDateIsProxy && by("7052").derogDateIsProxy).toBe(true);
  });
  it.each([
    ["4913", /balance \$18,263 exceeds \$14,700 limit/],
    ["9033", /high credit \$21,850 exceeds \$20,000 limit/],
    ["9033", /re-aging: closed 09\/2023, last activity 10\/2026; lates reported after close \(through 02\/2024\)/],
    ["0001", /paid \/ \$0 but still rated "90 Days Late"/],
  ])("flag on %s: %s", (mask, re) => expect((by(mask).accuracyFlags ?? []).join("; ")).toMatch(re));
  // v2.4 #6: a collector's open date is when it bought the debt — the original DLA normally comes first.
  it("no DLA-before-open flag on a collection; kept on original-creditor accounts", () => {
    expect((by("5291").accuracyFlags ?? []).join("; ")).not.toMatch(/predates open date/);
    const oc = buildCreditAnalysis(
      file([merged("LENDER X", "8080", "installment", B, { accountType: "Inst", balance: 900, creditLimit: 2000, dateLastActivity: "01/15/2022", dateOpened: "06/01/2023", paymentStatus: "90 Days Late", accountStatus: "90 Days Late", late90: 1 })]),
    );
    expect((oc.negatives[0].accuracyFlags ?? []).join("; ")).toMatch(/last activity 01\/2022 predates open date 06\/2023/);
  });
  it("derog date fallback matrix never uses Paid / Closed / Reported", () => {
    const t = (o: Partial<BureauTradeline>) => tl({ dateReported: "10/2026", dateOpened: null, ...o });
    expect(derogDateProxy([t({ closedDate: "10/2026", dateLastActivity: "05/2024" })], "collection", "03/2022")).toBe("03/2022");
    expect(derogDateProxy([t({ closedDate: "10/2026", dateLastActivity: "05/2021" })], "collection", "03/2022")).toBe("05/2021");
    expect(derogDateProxy([t({ closedDate: "01/2024", dateLastActivity: "09/2026" })], "charge_off", null)).toBeNull();
    expect(derogDateProxy([t({ dateLastDelinquent: "02/2023", closedDate: "01/2024" })], "late", "01/2019")).toBe("02/2023");
  });
});

describe("P1-2 inquiries: duplicates in one row, raw counts, lower odds", () => {
  const inq = (creditor: string, bureau: Bureau, date: string): CreditInquiry => ({ creditor, bureau, date, matchedAccount: null });
  const a = buildCreditAnalysis(
    file(
      [merged("AUTO BANK", "1000", "installment", ["TU", "EX"], { accountType: "Inst", balance: 30000, creditLimit: 31000, dateOpened: "09/21/2026" })],
      [inq("DEALER GROUP", "EX", "09/21/2026"), inq("DEALER GROUP", "EX", "09/18/2026"), inq("CAR LENDER", "EQ", "09/18/2026"), inq("OTHER LENDER", "EX", "01/05/2026")],
    ),
  );
  it("same creditor + bureau = one dispute row (x2); counts stay raw", () => {
    const first = a.inquiries.find((q) => q.creditor === "DEALER GROUP" && q.duplicateOf == null)!;
    expect(first.duplicates).toBe(2);
    expect(a.inquiries.filter((q) => q.duplicateOf != null)).toHaveLength(1);
    expect(a.overview.EX.hardInquiries).toBe(3);
    expect(a.overview.EQ.hardInquiries).toBe(1);
    expect(a.overview.TU.hardInquiries).toBe(0);
  });
  it("account opened within 45 days tags 'lower odds' but stays a target; older pulls are untagged", () => {
    for (const q of a.inquiries.filter((x) => x.date.startsWith("09/"))) {
      expect(q.action).toBe("dispute");
      expect(q.nearAccount).toMatch(/lower odds: AUTO BANK opened 09\/2026/);
    }
    expect(a.inquiries.find((q) => q.creditor === "OTHER LENDER")!.nearAccount ?? null).toBeNull();
  });
  it("TransUnion with 0 inquiries does not move in Round 1", () => {
    const r1 = a.projections.find((p) => p.key === "round1")!;
    expect(r1.scores.TU).toBe(530);
    expect(r1.scores.EX!).toBeGreaterThan(589);
  });
});

describe("§7 self-check gate", () => {
  it.each([
    ["Equifax scored but 0 tradelines (EQX not read)", ["TU", "EX"] as Bureau[], false],
    ["every scored bureau covered", B, true],
  ])("%s", (_n, bureaus, ok) => {
    const a = buildCreditAnalysis(file([merged("CARD", "1000", "revolving", bureaus, { creditLimit: 1000, balance: 100 })]));
    expect(a.selfCheck!.items.find((i) => i.key === "bureau_coverage")!.ok).toBe(ok);
    expect(a.selfCheck!.ok).toBe(ok);
  });
  it("Credit Summary reconciles: typed + Unkn, collections/charge-offs, utilization ±5", () => {
    const accts = [
      merged("COLLECTOR", "1", "collection", B, { accountType: "Unkn", balance: 100, paymentStatus: "Collection" }),
      merged("CARD", "2", "revolving", B, { creditLimit: 1000, balance: 420 }),
    ];
    const ok = buildCreditAnalysis(file(accts, [], { summary: { totalAccounts: 1, revolvingAccounts: 1, installmentAccounts: 0, otherAccounts: 0, totalBalance: null, revolvingBalance: null, pastDue: null, late30: null, late60: null, late90: null, collectionsChargeOffs: 1, revolvingUtilizationPct: 42 } }));
    expect(ok.selfCheck!.items.filter((i) => ["accounts", "derogs", "utilization"].includes(i.key)).every((i) => i.ok)).toBe(true);
    const bad = buildCreditAnalysis(file(accts, [], { summary: { totalAccounts: 1, revolvingAccounts: 1, installmentAccounts: 0, otherAccounts: 0, totalBalance: null, revolvingBalance: null, pastDue: null, late30: null, late60: null, late90: null, collectionsChargeOffs: 3, revolvingUtilizationPct: 0 } }));
    expect(bad.selfCheck!.items.find((i) => i.key === "derogs")!.ok).toBe(false);
    expect(bad.selfCheck!.items.find((i) => i.key === "utilization")!.ok).toBe(false);
    expect(bad.selfCheck!.ok).toBe(false);
  });
});

describe("P1-8 / P2-1 / P2-2 / P1-6 client PDF", () => {
  const accts = [
    merged("AUTO BANK", "1000", "installment", ["TU", "EX"], { accountType: "Inst", balance: 33926, creditLimit: 33721, dateOpened: "09/2026" }, { monthlyPayment: 858 }),
    merged("ISSUER A", "1927", "revolving", ["TU", "EX"], { creditLimit: 7500, dateReported: "06/08/2022" }, { ecoa: "T" }),
    merged("LOANCO", "4930", "installment", B, { accountType: "Inst", creditLimit: 930, closedDate: "06/2025" }),
    merged("ISSUER C", "7430", "revolving", B, { creditLimit: 500, closedDate: "06/2024" }),
  ];
  const a = buildCreditAnalysis(
    file(accts, [], { identityFlags: [{ bureau: "TU", field: "address", detail: "MAIN ST, TOWN, CA - REPORTED 10/24/•••; OAK AV - REPORTED 06/- 10/" }] }),
  );
  it("positives carry their real status; installments show the original amount", () => {
    const s = Object.fromEntries(a.positives.map((p) => [p.mask, p]));
    expect(s["1000"].statusLabel).toBe("Open");
    expect(s["1000"].amountKind).toBe("original");
    // v2.4 #2: terminated (ECOA T) is listed as not counted; 12+ months unreported = stale.
    expect(s["1927"].statusLabel).toBe("Terminated (ECOA T) - not counted (stale, last rptd 06/2022)");
    expect(s["4930"].statusLabel).toBe("Paid 06/2025");
    expect(s["7430"].statusLabel).toBe("Closed 06/2024");
  });
  it("PDF: source line, banner, full name, full enrollment URL, no fragments", async () => {
    const text = await pdfText(a);
    expect(text).toContain("Jane Marie Doe Sample");
    // v2.4 #16: "ordered <date>" is dropped when it matches the report date (one-line header).
    expect(text).toContain("Xactus tri-merge #12345678 (STATEWIDE)");
    expect(text).not.toMatch(/ordered 10\/26\/2026/);
    expect(text).toMatch(/Mortgage file: pulled by Pat Lender via STATEWIDE \/ Xactus on 10\/26\/2026/);
    expect(text).toContain("https://www.ofgllc.com/go/enroll-standard");
    expect(text).toMatch(/orig\. amt \$33,721\), \$858\/mo/);
    expect(text).not.toMatch(/REPORTED \d{1,2}\/\d{0,2}\/?(?![\d/])|•/);
    expect(text).toMatch(/confirm with client before disputing/);
  });
  it.each([
    ["REPORTED 10/24/", "REPORTED (date not itemized)"],
    ["REPORTED 06/- 10/", "REPORTED (date not itemized)"],
    ["REPORTED 10/24/2026", "REPORTED 10/24/2026"],
    ["since 06/2022", "since 06/2022"],
    ["123 MAIN ST ••• CA", "123 MAIN ST CA"],
    ["950 S FAIRFAX APT 3/4", "950 S FAIRFAX APT 3/4"],
    ["MOVED 10/24", "MOVED 10/24"],
    ["REPORTED 06/2022 - 10/", "REPORTED 06/2022 - (date not itemized)"],
  ])("completeValuesOnly(%j)", (raw, out) => expect(completeValuesOnly(raw)).toBe(out));
  it.each([
    ["SSN 123-45-6789", "SSN •••"],
    ["SSN 123456789", "SSN •••"],
    ["950 S FAIRFAX AVE 90036 - REPORTED 10/24/2026", "950 S FAIRFAX AVE 90036 - REPORTED 10/24/2026"],
  ])("maskSsnLike(%j) keeps years / ZIPs / house numbers", (raw, out) => expect(maskSsnLike(raw)).toBe(out));
});

describe("audit follow-ups (real Xactus re-read, Oct 26)", () => {
  it("charge-off: high credit = balance is not flagged twice; a real high credit over the limit still is", () => {
    const a = buildCreditAnalysis(
      file([
        merged("BANK CARD", "4913", "revolving", B, { balance: 18263, creditLimit: 14700, closedDate: "09/2025", paymentStatus: "Charge Off", pastDue: 18263 }, { highCredit: 18263 }),
        merged("ISSUER", "6661", "revolving", B, { creditLimit: 300, closedDate: "04/2026", late30: 3, gridMarks: ["12/2022:30"] }, { highCredit: 452 }),
      ]),
    );
    const flags = (m: string) => (a.negatives.find((n) => n.mask === m)!.accuracyFlags ?? []).join("; ");
    expect(flags("4913")).toMatch(/balance \$18,263 exceeds/);
    expect(flags("4913")).not.toMatch(/high credit/);
    expect(flags("6661")).toMatch(/high credit \$452 exceeds \$300 limit/);
  });
  it("Spanish PDFs never print the English 'not itemized' fragment", () => {
    expect(completeValuesOnly("REPORTADO 10/24/", true)).toBe("REPORTADO (fecha no detallada)");
  });
});

describe("5-page contract under load (synthetic tri-merges)", () => {
  const big = (cards: number, negs: number, pos: number, inq: number) => {
    const accounts = [
      ...Array.from({ length: cards }, (_, i) => merged(`CARD ISSUER ${i}`, String(1000 + i), "revolving", B, { balance: i * 50, creditLimit: 2000, closedDate: i % 2 ? "01/2024" : null })),
      ...Array.from({ length: negs }, (_, i) => merged(`COLLECTION AGENCY ${i}`, String(2000 + i), "collection", B, { balance: 300 + i, paymentStatus: "Collection", accountStatus: "Collection" })),
      ...Array.from({ length: pos }, (_, i) => merged(`INSTALLMENT LENDER ${i}`, String(3000 + i), "installment", B, { accountType: "Inst", balance: 500, creditLimit: 5000 })),
    ];
    const inquiries = Array.from({ length: inq }, (_, i) => ({ creditor: `LENDER NUMBER ${i}`, bureau: B[i % 3], date: `0${(i % 9) + 1}/1${i % 9}/2026`, matchedAccount: null }));
    return buildCreditAnalysis(file(accounts, inquiries));
  };
  it.each([
    [10, 10, 8, 10],
    [30, 25, 20, 40],
  ])("%i cards / %i negatives / %i positives / %i inquiries → 5 pages, totals over every card", async (c, n, p, q) => {
    const a = big(c, n, p, q);
    const { pages } = await generateOfgCreditAnalysisPdfWithMeta(a, { clientName: "J", lang: "en", program });
    expect(pages).toBe(5);
    const text = await pdfText(a);
    // v2.4 #3: the total covers every open card in good standing (all rows still listed / counted in "+N more").
    const lim = a.utilization.filter((u) => u.status === "open" && !u.derogatory).reduce((s, u) => s + u.limit, 0);
    expect(text).toMatch(new RegExp(`Total \\(open cards in good standing\\) \\$${lim.toLocaleString("en-US")}`));
  });
  it("extreme file (60 cards / 40 negatives / 80 inquiries) still lists every negative", async () => {
    const a = big(60, 40, 40, 80);
    const text = await pdfText(a);
    for (const neg of a.negatives) expect(text).toContain(neg.creditor);
  });
});

describe("Remaining Fixes R-1..R-8 (Cesar, Oct 26)", () => {
  const inq = (creditor: string, bureau: Bureau, date: string): CreditInquiry => ({ creditor, bureau, date, matchedAccount: null });
  const laila = () =>
    buildCreditAnalysis(
      file(
        [
          merged("BANK CARD", "4913", "revolving", B, { balance: 18263, creditLimit: 14700, closedDate: "09/2025", paymentStatus: "Charge Off", accountStatus: "Charge Off", pastDue: 18263 }),
          merged("ISSUER A", "1927", "revolving", ["TU", "EX"], { creditLimit: 7500, dateReported: "06/08/2022" }, { ecoa: "T" }),
          merged("ISSUER B", "9033", "revolving", B, { creditLimit: 20000, closedDate: "09/2023" }),
          merged("ISSUER C", "7430", "revolving", B, { creditLimit: 500, closedDate: "06/2024" }),
          merged("ISSUER D", "6661", "revolving", B, { creditLimit: 300, closedDate: "04/2026" }),
          merged("AUTO BANK", "1000", "installment", ["TU", "EX"], { accountType: "Inst", balance: 33926, creditLimit: 33721, dateOpened: "09/21/2026" }),
          merged("UTILITY CO", "4F14", "other", ["EQ"], { accountType: "Open", creditLimit: 59, dateReported: "08/03/2021" }),
        ],
        [inq("DEALER GROUP", "EX", "09/21/2026"), inq("ACME FINANCE", "EQ", "09/18/2026"), inq("ZETA CAPITAL", "EX", "09/18/2026"), inq("DEALER GROUP", "EX", "09/18/2026"), inq("OMEGA LENDING", "EX", "09/18/2026")],
      ),
    );
  it("R-1 + v2.4 #3/#9: no open card in good standing → N/A, and the balance is named as the charge-off", async () => {
    const a = laila();
    const text = await pdfText(a);
    expect(text).not.toMatch(/\b4[23]% \(\$18,263/);
    expect(text).toMatch(/Revolving utilization N\/A N\/A N\/A/);
    expect(text).toMatch(/Total \(open cards in good standing\) \$0 \$0 N\/A N\/A N\/A/);
    expect(text).toContain("All revolving balance ($18,263) is the charged-off BANK CARD; no open card in good standing.");
    expect(text).not.toMatch(/Revolving utilization is \d+%/);
  });
  it("R-2: a duplicate pull is never also in the cluster; the cluster names its creditors", async () => {
    const a = laila();
    expect(a.inquiryClusters).toHaveLength(1);
    expect(a.inquiryClusters[0].count).toBe(3);
    const text = await pdfText(a);
    // v2.4 #10: pulls days apart from one creditor are a repeat pull, never a "duplicate".
    expect(text).toMatch(/DEALER GROUP \(x2\), 09\/18 \+ 09\/21\/2026 Inquiry EX repeat pull, auto-shopping window/);
    expect(text).not.toMatch(/DEALER GROUP[^\n]*duplicate/);
    expect(text).toMatch(/3 same-day inquiries \(09\/18\/2026\) Inquiry EX, EQ ACME FINANCE \(EQ\); ZETA CAPITAL, OMEGA LENDING \(EX\) - No verified permissible purpose \(lower odds: AUTO BANK opened 09\/2026\)/);
  });
  it("R-3 / R-4 / R-5 / R-6 / R-7 / R-8 wording", async () => {
    const text = await pdfText(laila());
    expect(text).toContain("Lender file lists last 120 days only; pull MFSN for 12 months.");
    expect(text).toMatch(/Mortgage file pulled by Pat Lender via STATEWIDE: that pull is a permissible-purpose inquiry/);
    expect(text).toContain("https://www.ofgllc.com/go/enroll-standard");
    expect(text).toContain("All card utilization on this file comes from the charged-off BANK CARD balance, so it is addressed through the Round 4 accuracy dispute.");
    expect(text).toMatch(/UTILITY CO \.\.\.4F14 Open .* \$0 \(no limit\)/);
    expect(text).toMatch(/Round 1 - inquiries \+ personal info 530 \(no TU inquiries\)/);
    expect(text).not.toMatch(/\(530-530\)/);
  });
  it("R-8 never hides a real move: a bureau with items keeps its + and range", async () => {
    const text = await pdfText(laila());
    expect(text).toMatch(/Round 1 - inquiries \+ personal info 530 \(no TU inquiries\) \d{3}\+ \(\d{3}-\d{3}\)/);
  });
});

describe("projection cells never print a collapsed range", () => {
  it("a capped bureau prints 'NNN+', never 'NNN+ (NNN-NNN)'", async () => {
    const accounts = Array.from({ length: 25 }, (_, i) => merged(`COLLECTION AGENCY ${i}`, String(2000 + i), "collection", B, { balance: 300 + i, paymentStatus: "Collection", accountStatus: "Collection" }));
    const text = await pdfText(buildCreditAnalysis(file(accounts)));
    expect(text).not.toMatch(/(\d{3})\+ \(\1-\1\)/);
  });
});
