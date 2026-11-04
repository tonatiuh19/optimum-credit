/**
 * OFG Report Engine Fix List v2.4 (Cesar, Oct 27 2026) — engine rules checked
 * over combinations of the conditions that broke them, synthetic files only:
 * ECOA T / stale cards out of utilization, good-standing denominator, current
 * address never a target + unit mismatches, name errors vs normal formats,
 * account type vs issue, DLA-vs-open on collections, duplicate vs repeat
 * pulls, and the client PDF wording (VantageScore, graphic bars kept, labels, header).
 */
import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry, IdentityFlag } from "./creditFile";
import { accountTypeLabel, buildCreditAnalysis, nameVariantIsError, normalizeIdentityFlags, parseIdentityAddress } from "./creditAnalysisFromFile";
import { generateOfgCreditAnalysisPdfWithMeta, keyObservations, OFG_REPORT_CONTACT } from "./ofgCreditAnalysisPdf";

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
const acct = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Bureau[], o: Partial<BureauTradeline>, extra: Partial<CreditAccount> = {}): CreditAccount => ({
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
const render = async (a: ReturnType<typeof buildCreditAnalysis>, lang: "en" | "es" = "en") => {
  const { buffer, pages } = await generateOfgCreditAnalysisPdfWithMeta(a, { clientName: "Client", lang, program });
  return { pages, text: (await new PDFParse({ data: buffer }).getText()).text.replace(/\s+/g, " ") };
};
const inq = (creditor: string, bureau: Bureau, date: string): CreditInquiry => ({ creditor, bureau, date, matchedAccount: null });

const chargeOff = acct("BANK CARD", "4913", "revolving", B, { balance: 18263, creditLimit: 14700, closedDate: "09/2025", paymentStatus: "Charge Off", accountStatus: "Charge Off", pastDue: 18263 });
const terminated = acct("ISSUER A", "1927", "revolving", ["TU", "EX"], { creditLimit: 7500, dateReported: "06/08/2022" }, { ecoa: "T" });
const closedCard = acct("ISSUER B", "9033", "revolving", B, { creditLimit: 20000, closedDate: "09/2023" });
const openCard = (bal: number, lim: number, mask = "5000") => acct("GOOD BANK", mask, "revolving", B, { balance: bal, creditLimit: lim });

describe("#2 / #3 utilization = open cards in good standing only (every format)", () => {
  const cases: Array<{ name: string; cards: CreditAccount[]; fmt: "merged" | "per_bureau"; pct: number | null }> = [
    { name: "charge-off + terminated + closed (no good card)", cards: [chargeOff, terminated, closedCard], fmt: "merged", pct: null },
    { name: "same file, per-bureau report", cards: [chargeOff, terminated, closedCard], fmt: "per_bureau", pct: null },
    { name: "terminated card + one open card", cards: [terminated, openCard(500, 1000)], fmt: "merged", pct: 50 },
    { name: "charge-off + one open card", cards: [chargeOff, openCard(300, 3000)], fmt: "merged", pct: 10 },
    { name: "closed card with a balance + open card", cards: [acct("ISSUER C", "7430", "revolving", B, { balance: 400, creditLimit: 500, closedDate: "06/2024" }), openCard(0, 2000)], fmt: "per_bureau", pct: 0 },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const a = buildCreditAnalysis(file(c.cards, [], { reportFormat: c.fmt }));
      expect(a.utilizationOverall.all).toBe(c.pct);
      for (const b of B) if (a.overview[b].utilizationPct !== null) expect(a.overview[b].revolvingLimit).toBeLessThanOrEqual(3000);
      const t1927 = a.utilization.find((u) => u.mask === "1927");
      if (t1927) {
        expect(t1927.status).toBe("terminated");
        expect(a.positives.find((p) => p.mask === "1927")?.statusLabel).toMatch(/^Terminated \(ECOA T\) - not counted \(stale, last rptd 06\/2022\)/);
      }
      const { text, pages } = await render(a);
      expect(pages).toBe(5);
      if (c.pct === null) {
        // Tri-merges list every card, so the Total row prints N/A; per-bureau files list open cards only.
        if (c.fmt === "merged") expect(text).toMatch(/Total \(open cards in good standing\) \$0 \$0 N\/A N\/A N\/A/);
        expect(text).toContain("No open card in good standing - utilization not applicable.");
      } else expect(text).not.toContain("utilization not applicable");
      // Payoff targets only on cards in good standing.
      expect(text).not.toMatch(/ISSUER A \.\.\.1927 Terminated \(ECOA T\) - not counted \$7,500 \$0 0% \$2,250/);
    });
  }
  // Cesar, Oct 27: no open card in good standing → "Open revolving accounts" 0/20 (closed history earns nothing).
  it.each([
    ["charge-off + terminated", [terminated, chargeOff], 0],
    ["charge-off + terminated + closed", [terminated, chargeOff, closedCard], 0],
    ["one open card in good standing", [chargeOff, openCard(100, 5000)], 8],
    ["two open cards under 10% (12 + 2 bonus)", [openCard(100, 5000), openCard(100, 5000, "5001")], 14],
  ] as Array<[string, CreditAccount[], number]>)("File Strength revolving: %s → %s/20", async (_n, cards, pts) => {
    const a = buildCreditAnalysis(file(cards));
    const rev = a.fileStrength.factors.find((f) => f.key === "revolving")!;
    expect(rev.current).toBe(pts);
    expect(a.fileStrength.current).toBe(a.fileStrength.factors.reduce((s, f) => s + f.current, 0));
    expect(a.fileStrength.postRepair).toBe(a.fileStrength.factors.reduce((s, f) => s + f.postRepair, 0));
    const { text } = await render(a);
    expect(text).toContain(`Open revolving accounts ${pts} / 20`);
    expect(text).toContain(`TOTAL ${a.fileStrength.current} / 100 ${a.fileStrength.postRepair} / 100`);
  });
  it("the lender self-check still compares the lender's own all-lines figure", () => {
    const a = buildCreditAnalysis(file([chargeOff, terminated, closedCard], [], { summary: { revolvingUtilizationPct: 43 } as CreditFile["summary"] }));
    const item = a.selfCheck!.items.find((i) => i.key === "utilization");
    expect(item?.ok).toBe(true);
  });
});

describe("#9 key observation names where the balance sits", () => {
  it.each([
    [[chargeOff, closedCard], /All revolving balance \(\$18,263\) is the charged-off BANK CARD; no open card in good standing\./],
    [[chargeOff, openCard(100, 5000)], /All revolving balance \(\$18,263\) is the charged-off BANK CARD\.$|^((?!no open card).)*$/],
  ] as Array<[CreditAccount[], RegExp]>)("%#", (cards, re) => {
    const obs = keyObservations(buildCreditAnalysis(file(cards)), false);
    expect(obs.find((o) => /revolving/i.test(o)) ?? "").toMatch(re);
    expect(obs.join(" ")).not.toMatch(/Revolving utilization is 1\d\d%/);
  });
  it("an open card carrying the balance keeps the plain utilization line", () => {
    const obs = keyObservations(buildCreditAnalysis(file([openCard(2000, 4000)])), false);
    expect(obs).toContain("Revolving utilization is 50%.");
  });
  it("Spanish", () => {
    const obs = keyObservations(buildCreditAnalysis(file([chargeOff, closedCard])), true);
    expect(obs.join(" ")).toMatch(/Todo el saldo revolvente \(\$18,263\) esta en la tarjeta en cargo a perdida BANK CARD; ninguna tarjeta abierta en buen estado\./);
  });
});

describe("#7 name variants: only real errors", () => {
  const legal = "Laila Louise Reaves Elhassani".toUpperCase().replace(/LAILA/, "JANE").replace(/LOUISE/, "MARIE").replace(/REAVES/, "DOE").replace(/ELHASSANI/, "SAMPLESON");
  it.each([
    ["JANE M. DOESAMPLESON", false],
    ["JANE DOE SAMPLESON", false],
    ["JANE DOE SAMPLE SON", false],
    ["JANE MARIE DOE-SAMPLESON", false],
    ["SAMPLESON JANE DOE", false],
    ["JANE M DOE SA", false],
    ["J DOE SAMPLESON", false],
    ["JANE MARIE DOE SAMPLESO", true],
    ["JANE JANE", true],
    ["JANE SMITH", true],
    ["JANNE DOE SAMPLESON", true],
  ])("%s → error=%s", (variant, err) => expect(nameVariantIsError(variant, legal)).toBe(err));
  it("AKA lists keep only the errors, per bureau, without the AKA prefix", () => {
    const flags = normalizeIdentityFlags(
      [
        { bureau: "TU", field: "name", detail: "Jane Marie Doe Sampleso" },
        { bureau: "EX", field: "name", detail: "Jane M. Doesampleson; AKA: JANE DOE SA; AKA: JANE JANE; AKA: SAMPLESON JANE DOE" },
        { bureau: "EQ", field: "name", detail: "AKA: JANE SAMPLE SON; AKA: JANE MARIE DOE-SAMPLESON" },
      ],
      legal,
    );
    expect(flags).toEqual([
      { bureau: "TU", field: "name", detail: "Jane Marie Doe Sampleso" },
      { bureau: "EX", field: "name", detail: "JANE JANE" },
    ]);
  });
  it("without a legal name the old cross-bureau rule still applies", () => {
    const flags = normalizeIdentityFlags([{ bureau: "TU", field: "name", detail: "A B" }, { bureau: "EX", field: "name", detail: "A B" }], null);
    expect(flags).toEqual([]);
  });
});

describe("#4 addresses: current address never a target; unit mismatches are", () => {
  const addr = (b: Bureau, d: string): IdentityFlag => ({ bureau: b, field: "address", detail: d });
  const rows = [
    addr("TU", "100 N MAIN AV 506, SPRINGFIELD, CA ••• - REPORTED 01/24/2023"),
    addr("TU", "77 OAK DR 517, AUSTIN, TX ••• - REPORTED 01/21/2022"),
    addr("TU", "5 ELM AV 807, NORTH TOWN, CA ••• - REPORTED 10/24/2023"),
    addr("EX", "100 N MAIN AVE, SPRINGFIELD, CA ••• - REPORTED 08/27/2023 - 10/21/2026"),
    addr("EX", "5 ELM AVE APT 807, NORTH TOWN, CA ••• - REPORTED 10/25/2023 - 11/15/2023"),
    addr("EX", "9 PINE ST, MIAMI, FL ••• - REPORTED 04/11/2025 - 04/11/2025"),
    addr("EQ", "100 N MAIN AVENUE APT 320, SPRINGFIELD, CA 90036 - REPORTED 06/2023 - 10/2026"),
    addr("EQ", "5 ELM AVE APT 807, NORTH TOWN, CA 91601 - REPORTED 11/2023 - 07/2026"),
    addr("EQ", "9 PINE ST, MIAMI, FL 33130 - REPORTED 03/2025 - 10/2026"),
  ];
  for (const borrower of ["100 N Main Ave, Springfield, CA 90036", null]) {
    it(`borrower block ${borrower ? "given" : "missing (most recent wins)"}`, () => {
      const flags = normalizeIdentityFlags(rows, "JANE DOE", borrower);
      const mismatch = flags.filter((f) => f.kind === "unit_mismatch");
      expect(mismatch.map((f) => f.bureau).sort()).toEqual(["EQ", "EX", "TU"]);
      expect(mismatch[0].detail).toBe("100 N MAIN AVE: #506 (TU) vs no unit (EX) vs #320 (EQ)");
      // The current street is never a "confirm" / dispute row; 5 ELM (same unit on all three) is consistent.
      const confirm = flags.filter((f) => f.kind === "confirm");
      expect(confirm.some((f) => /MAIN/.test(f.detail))).toBe(false);
      expect(confirm.some((f) => /ELM/.test(f.detail))).toBe(false);
      expect(confirm.map((f) => `${f.bureau} ${f.detail.split(",")[0]}`).sort()).toEqual(["EQ 9 PINE ST", "EX 9 PINE ST", "TU 77 OAK DR 517"]);
    });
  }
  it.each([
    ["950 S FAIRFAX AV 506, LOS ANGELES, CA", "950 S FAIRFAX AVE", "506"],
    ["950 S FAIRFAX AVE APT 320, LOS ANGELES, CA 90036", "950 S FAIRFAX AVE", "320"],
    ["950 S FAIRFAX AVE #12B, LOS ANGELES, CA", "950 S FAIRFAX AVE", "12B"],
    ["86 SW 8TH ST, MIAMI, FL", "86 SW 8TH ST", null],
    ["1115 TOWN CREEK DR 517, AUSTIN, TX", "1115 TOWN CREEK DR", "517"],
  ])("parse %s", (raw, street, unit) => {
    const p = parseIdentityAddress(raw)!;
    expect(p.display).toBe(street);
    expect(p.unit).toBe(unit);
  });
  it("PDF: one Round 1 unit-mismatch row; prior addresses say confirm with client", async () => {
    const a = buildCreditAnalysis(file([openCard(100, 2000)], [], { identityFlags: rows, borrowerAddress: "100 N Main Ave, Springfield, CA" }));
    const { text } = await render(a);
    expect(text).toMatch(/Personal info unit mismatch TU, EX, EQ 100 N MAIN AVE: #506 \(TU\) vs no unit \(EX\) vs #320 \(EQ\)/);
    expect(text).toMatch(/9 PINE ST, MIAMI, FL[^]*confirm with client before disputing/);
    expect(text).not.toMatch(/address \w+ 100 N MAIN AV/);
  });
});

describe("#5 Type = account type; #6 DLA check skips collections; #15 no repeated balance", () => {
  const accounts = [
    acct("AUTO BANK", "2268", "installment", B, { accountType: "Inst", remarks: "Automobile / CLOSED", closedDate: "06/2026", paymentStatus: "60 Days Late", late30: 2, late60: 1 }),
    acct("LENDER LOAN", "0001", "installment", B, { accountType: "Inst", remarks: "Unsecured Loan", paymentStatus: "90 Days Late", late90: 2, dateLastActivity: "01/2022", dateOpened: "05/2023" }),
    acct("COLLECTOR", "5291", "collection", ["EQ", "TU"], { accountType: "Unkn", paymentStatus: "Collection", accountStatus: "Collection", dateLastActivity: "06/28/2021", dateOpened: "04/10/2023", balance: 142 }),
    acct("HOME LENDER", "7777", "mortgage", B, { accountType: "Mtg", paymentStatus: "30 Days Late", late30: 1 }),
    acct("ED SERVICER", "8888", "installment", B, { accountType: "Inst", remarks: "Student loan", paymentStatus: "30 Days Late", late30: 1 }),
    chargeOff,
  ];
  const a = buildCreditAnalysis(file(accounts));
  const by = (m: string) => a.negatives.find((n) => n.mask === m)!;
  it.each([
    ["2268", "auto"],
    ["0001", "installment"],
    ["5291", "collection"],
    ["7777", "mortgage"],
    ["8888", "student_loan"],
    ["4913", "revolving"],
  ])("%s → %s", (m, t) => expect(by(m).accountType).toBe(t));
  it("open-type rows read Open", () => expect(accountTypeLabel(acct("UTIL", "1", "other", ["EQ"], { accountType: "Open", creditorType: "UTILITY" }), [tl({ accountType: "Open" })])).toBe("open"));
  it("DLA before open date: flagged on the original creditor, never on the collection", () => {
    expect((by("0001").accuracyFlags ?? []).join(" ")).toMatch(/last activity 01\/2022 predates open date 05\/2023/);
    expect((by("5291").accuracyFlags ?? []).join(" ")).not.toMatch(/predates/);
  });
  it("PDF rows print the account type, keep the issue in Status, and never repeat the balance", async () => {
    const { text } = await render(a);
    expect(text).toMatch(/LENDER LOAN \.\.\.0001 Installment/);
    expect(text).toMatch(/AUTO BANK \.\.\.2268 Auto/);
    expect(text).toMatch(/BANK CARD \.\.\.4913 Revolving/);
    expect(text).not.toMatch(/\.\.\.\d{4} (Late payments|Charge-off) /);
    expect(text).toMatch(/\$18,263 past due/);
    expect(text).not.toMatch(/\$18,263 past due[^(]*\(\$18,263\)/);
    expect(text).toMatch(/COLLECTOR \.\.\.5291 Collection [^]*\(\$142\)/);
  });
});

describe("#10 duplicate vs repeat pull", () => {
  const run = (qs: CreditInquiry[]) => buildCreditAnalysis(file([openCard(100, 2000)], qs)).inquiries.filter((q) => (q.duplicates ?? 1) > 1);
  it.each([
    ["same date → duplicate", [inq("RANDOM LENDER", "EX", "09/18/2026"), inq("RANDOM LENDER", "EX", "09/18/2026")], "duplicate", 1],
    ["3 days apart → repeat", [inq("LAND ROVER JAGUAR BEVE", "EX", "09/21/2026"), inq("LAND ROVER JAGUAR BEVE", "EX", "09/18/2026")], "repeat", 1],
    ["45 days apart → repeat", [inq("RANDOM LENDER", "EX", "08/01/2026"), inq("RANDOM LENDER", "EX", "09/15/2026")], "repeat", 1],
    ["60 days apart → two rows", [inq("RANDOM LENDER", "EX", "07/01/2026"), inq("RANDOM LENDER", "EX", "09/15/2026")], null, 0],
    ["other bureau → two rows", [inq("RANDOM LENDER", "EX", "09/18/2026"), inq("RANDOM LENDER", "EQ", "09/18/2026")], null, 0],
  ] as Array<[string, CreditInquiry[], string | null, number]>)("%s", (_n, qs, kind, groups) => {
    const g = run(qs);
    expect(g).toHaveLength(groups);
    if (kind) expect(g[0].duplicateKind).toBe(kind);
  });
  it("PDF wording: auto creditor → auto-shopping window; others → rate-shopping window", async () => {
    const a = buildCreditAnalysis(file([openCard(100, 2000)], [inq("LAND ROVER JAGUAR BEVE", "EX", "09/21/2026"), inq("LAND ROVER JAGUAR BEVE", "EX", "09/18/2026"), inq("ZETA CAPITAL", "EQ", "09/01/2026"), inq("ZETA CAPITAL", "EQ", "09/20/2026"), inq("OMEGA", "TU", "09/02/2026"), inq("OMEGA", "TU", "09/02/2026")]));
    const { text } = await render(a);
    expect(text).toMatch(/LAND ROVER JAGUAR BEVE \(x2\), 09\/18 \+ 09\/21\/2026 Inquiry EX repeat pull, auto-shopping window/);
    expect(text).toMatch(/ZETA CAPITAL \(x2\)[^]*repeat pull, rate-shopping window/);
    expect(text).toMatch(/OMEGA \(x2\)[^]*duplicate \(same creditor, bureau and date\)/);
  });
});

describe("#8 / #11 / #13 / #14 / #16 PDF wording and layout", () => {
  const base = () => buildCreditAnalysis(file([chargeOff, terminated, openCard(200, 2000)], [inq("RANDOM LENDER", "EX", "09/18/2026")]));
  it("VantageScore column always; Not itemized when the source has none", async () => {
    const { text } = await render(base());
    expect(text).toMatch(/Bureau (FICO|Score) Rating VantageScore TransUnion 530 Poor Not itemized/);
    const withV = buildCreditAnalysis(file([openCard(200, 2000)], [], { vantageScores: { TU: 612, EX: null, EQ: 640 } }));
    expect((await render(withV)).text).toMatch(/TransUnion 530 Poor 612 Experian 589 Fair Not itemized Equifax 559 Poor 640/);
  });
  it("score bars stay graphic (Cesar, Oct 27), never ASCII", async () => {
    const { text } = await render(base());
    expect(text).not.toMatch(/\[[#-]{20}\]/);
    expect(text).toMatch(/TransUnion 530 Experian 589 Equifax 559/);
  });
  it("Round 1 cell without inquiries on that bureau reads 'no TU inquiries'", async () => {
    const { text } = await render(base());
    expect(text).toMatch(/Round 1 - inquiries \+ personal info 530 \(no TU inquiries\)/);
    expect(text).not.toMatch(/no TU items\)[^]*Round 2/);
  });
  it("Section 2 is 'Positive Accounts'; header is one line without a repeated date", async () => {
    const { text } = await render(base());
    expect(text).toContain("SECTION 2 - POSITIVE ACCOUNTS");
    expect(text).not.toContain("ACTIVE + POSITIVE");
    expect(text).toContain("Report date: 10/26/2026 | Source: Xactus tri-merge #12345678 (STATEWIDE) Optimum");
    const other = buildCreditAnalysis(file([openCard(200, 2000)], [], { lender: { name: "STATEWIDE", requestedDate: "10/20/2026", requestedBy: "Pat", vendor: "Xactus", reportId: "1" } }));
    expect((await render(other)).text).toContain("(STATEWIDE), ordered 10/20/2026");
  });
  it("Spanish labels", async () => {
    const { text, pages } = await render(base(), "es");
    expect(pages).toBe(5);
    expect(text).toContain("SECCION 2 - CUENTAS POSITIVAS");
    expect(text).toMatch(/sin consultas en TU/);
  });
});
