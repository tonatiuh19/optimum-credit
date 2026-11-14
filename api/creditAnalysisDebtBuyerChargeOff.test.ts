/**
 * Nov 13, 2026 (Cesar — a MyFreeScoreNow 3-bureau report): two fixes for the free Credit Analysis.
 *  1. An original creditor and the debt buyer that bought the debt (same last 4, same balance) are two
 *     tradelines — never merged. Experian listing the buyer under Installment AND Other is one.
 *  2. Charge-offs are read from the remarks and the grid's "CO" cells even when the status says
 *     "Collection Account". Original-creditor charge-off → Round 4 (Round 3 first when the bureaus
 *     conflict); a "B" grid code with no bankruptcy, double reporting and lates a month apart are
 *     Round 3 points. Synthetic data shaped like the real report (no client data).
 */
import { describe, expect, it } from "vitest";
import type { Bureau, CreditAccount, CreditFile } from "./creditFile";
import { consolidateSplitAccounts, sameCreditorName } from "./creditFileExtract";
import { buildCreditAnalysis, hasChargeOffEvidence, negativeKind } from "./creditAnalysisFromFile";
import { acct, tl } from "./creditAnalysisFixtures";

const BUYER_REMARKS = "ORIGINAL CREDITOR: 12 CARD BANK AMERICAN EXPRESS\nORIGINAL CREDITOR: CARD BANK AMERICAN EXPRESS\nCOLLECTION ACCOUNT";

const securedCard = () =>
  acct({
    creditor: "Secured Card Bank", mask: "5590", section: "revolving",
    bureaus: {
      TU: tl({ dateOpened: "Feb 01, 2023", balance: 95, creditLimit: 200, accountStatus: "Closed", paymentStatus: "Collection Account", closedDate: "Dec 01, 2024", dateLastActivity: "Sep 01, 2024", pastDue: 95 }),
      EX: tl({ dateOpened: "Feb 01, 2023", balance: 95, creditLimit: 200, accountStatus: "Closed", paymentStatus: "Pays as Agreed", late30: 2, late60: 1, late90: 1, pastDue: 95,
        remarks: "ACCOUNT CHARGED TO PROFIT AND LOSS", gridMarks: ["09/2024:30", "10/2024:30", "11/2024:60", "12/2024:90", "01/2026:CO", "02/2026:CO"] }),
      EQ: tl({ dateOpened: "Feb 01, 2023", balance: 95, creditLimit: 200, accountStatus: "Collection Account", paymentStatus: "Collection", late90: 1, pastDue: 95, dateLastActivity: "Jul 01, 2024",
        remarks: "UNPAID BALANCE REPORTED AS A LOSS BY CREDIT GRANTOR", gridMarks: ["11/2024:90", "12/2024:CO", "01/2025:CO"] }),
    },
  });
const originalCard = () =>
  acct({
    creditor: "Card Bank", mask: "0730", section: "revolving",
    bureaus: {
      EX: tl({ dateOpened: "Dec 01, 2023", balance: 732, creditLimit: 300, accountStatus: "Closed", paymentStatus: "Over 120 Days Past Due", late30: 1, late60: 1, late90: 1, pastDue: 732,
        gridMarks: ["02/2025:30", "03/2025:60", "04/2025:90", "05/2025:120", "06/2025:B", "07/2025:CO"] }),
      EQ: tl({ dateOpened: "Dec 01, 2023", balance: 732, creditLimit: 300, accountStatus: "Collection Account", paymentStatus: "Collection", late30: 1, late60: 1, late90: 1, pastDue: 732,
        remarks: "UNPAID BALANCE REPORTED AS A LOSS BY CREDIT GRANTOR\nCHARGED OFF ACCOUNT", gridMarks: ["01/2025:30", "02/2025:60", "03/2025:90", "04/2025:120"] }),
    },
  });
// The debt buyer, as the bureaus file it: Experian under "Installment", Equifax + TransUnion under "Other".
const buyerInstallment = () =>
  acct({
    creditor: "Debt Buyer Llc", mask: "0730", section: "installment", headerStatus: "Original creditor: CARD BANK AMERICAN EXPRESS",
    bureaus: { EX: tl({ dateOpened: "Aug 01, 2025", balance: 732, creditLimit: 0, accountStatus: "Closed", paymentStatus: "Collection Account", accountType: "Installment", pastDue: 732, remarks: BUYER_REMARKS, gridMarks: ["11/2025:CO", "12/2025:CO"] }) },
  });
const buyerOther = () =>
  acct({
    creditor: "Debt Buyer Llc", mask: "0730", section: "other", headerStatus: "Original creditor: CARD BANK AMERICAN EXPRESS",
    bureaus: {
      EQ: tl({ dateOpened: "Aug 01, 2025", balance: 732, creditLimit: 0, accountStatus: "Collection Account", paymentStatus: "Collection", accountType: "Other", pastDue: 732, remarks: BUYER_REMARKS }),
      TU: tl({ dateOpened: "Aug 01, 2025", balance: 732, creditLimit: 0, accountStatus: "Collection Account", paymentStatus: "Collection", accountType: "Other", pastDue: 0, remarks: BUYER_REMARKS }),
    },
  });
const insuranceCollection = () =>
  acct({
    creditor: "Nations Insuran", mask: "5220", section: "other", headerStatus: "Original creditor: NATIONS INSURAN",
    bureaus: { EQ: tl({ balance: 59, accountStatus: "Collection Account", paymentStatus: "Collection", remarks: "ORIGINAL CREDITOR: NATIONS INSURAN" }) },
  });

const file = (accounts: CreditAccount[], over: Partial<CreditFile> = {}): CreditFile =>
  ({
    provider: "equifax_3b", reportDate: "11/12/2026", reportFormat: "per_bureau", scores: { TU: 501, EX: 501, EQ: 503 },
    accounts, inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 23, confidence: 1, warnings: [], identityFlags: [], ...over,
  }) as unknown as CreditFile;
const read = (rows: CreditAccount[], over: Partial<CreditFile> = {}) => buildCreditAnalysis(file(consolidateSplitAccounts(rows), over));
const caseRows = () => [securedCard(), originalCard(), buyerInstallment(), insuranceCollection(), buyerOther()];
const neg = (a: ReturnType<typeof read>, creditor: string) => a.negatives.find((n) => n.creditor === creditor)!;
const onBureau = (a: ReturnType<typeof read>, b: Bureau) => a.negatives.filter((n) => n.bureaus.includes(b)).length;

describe("Fix 1: original creditor and debt buyer are two tradelines", () => {
  it("the full case: 4 negatives (EQ 4, EX 3, TU 2); the original creditor is not on TU", () => {
    const a = read(caseRows());
    expect(a.negatives).toHaveLength(4);
    expect([onBureau(a, "EQ"), onBureau(a, "EX"), onBureau(a, "TU")]).toEqual([4, 3, 2]);
    expect(neg(a, "Card Bank").bureaus.sort()).toEqual(["EQ", "EX"]);
    expect(neg(a, "Card Bank").originalCreditor).toBeNull(); // never "orig. Debt Buyer" (backwards)
  });

  it("the debt buyer listed under Installment (EX) and Other (EQ, TU) is one account on all three bureaus", () => {
    const rows = consolidateSplitAccounts(caseRows());
    const buyer = rows.filter((r) => r.creditor === "Debt Buyer Llc");
    expect(buyer).toHaveLength(1);
    expect((["TU", "EX", "EQ"] as Bureau[]).filter((b) => buyer[0].bureaus[b])).toEqual(["TU", "EX", "EQ"]);
    expect(buyer[0].bureaus.TU!.dateOpened).toBe("Aug 01, 2025");
  });

  it("the original creditor keeps its own open date (12/2023), never the buyer's (08/2025)", () => {
    const card = consolidateSplitAccounts(caseRows()).find((r) => r.creditor === "Card Bank")!;
    expect(card.bureaus.TU).toBeUndefined();
    expect(card.bureaus.EQ!.dateOpened).toBe("Dec 01, 2023");
  });

  it("never merges a collector and the creditor it names, even with no bureau in common", () => {
    const oc = acct({ creditor: "Card Bank", mask: "0730", section: "revolving", bureaus: { EX: tl({ balance: 732, paymentStatus: "Charge-off" }) } });
    const buyer = acct({ creditor: "Debt Buyer Llc", mask: "0730", section: "collection", bureaus: { TU: tl({ balance: 732, paymentStatus: "Collection", remarks: "ORIGINAL CREDITOR: CARD BANK" }) } });
    expect(consolidateSplitAccounts([oc, buyer])).toHaveLength(2);
  });

  it("still merges one account split across bureau rows: same name, or a bureau's own spelling in the same section", () => {
    const a = acct({ creditor: "CAPITAL ONE", mask: "1234", section: "revolving", bureaus: { TU: tl({ balance: 500 }) } });
    const b = acct({ creditor: "CAP ONE", mask: "1234", section: "revolving", bureaus: { EQ: tl({ balance: 500 }) } });
    expect(consolidateSplitAccounts([a, b])).toHaveLength(1);
    const c = acct({ creditor: "ALLY CREDIT CARD/CWS", mask: "3993", section: "revolving", bureaus: { TU: tl({ balance: 2367 }) } });
    const d = acct({ creditor: "ALLY CREDI", mask: "3993", section: "unknown", bureaus: { EQ: tl({ balance: 2367 }) } });
    expect(consolidateSplitAccounts([c, d])).toHaveLength(1);
  });

  it("two collection listings of one item under the agency and its client (MyFreeScoreNow) stay one; a card + a collection stay two", () => {
    const x = acct({ creditor: "Collector One", mask: "4444", section: "collection", bureaus: { EQ: tl({ balance: 300, paymentStatus: "Collection" }) } });
    const y = acct({ creditor: "Medical Group", mask: "4444", section: "installment", bureaus: { EQ: tl({ balance: 300, accountStatus: "Collection Account", paymentStatus: "Collection" }) } });
    expect(consolidateSplitAccounts([x, y])).toHaveLength(1);
    const card = acct({ creditor: "Medical Group", mask: "4444", section: "revolving", bureaus: { EQ: tl({ balance: 300, creditLimit: 500, paymentStatus: "Collection" }) } });
    expect(consolidateSplitAccounts([x, card])).toHaveLength(2);
  });

  it("sameCreditorName: exact, shortened (5+ letters) and different names", () => {
    expect(sameCreditorName("Lvnv Funding Llc", "LVNV FUNDING LLC")).toBe(true);
    expect(sameCreditorName("ALLY CREDI", "ALLY CREDIT CARD/CWS")).toBe(true);
    expect(sameCreditorName("ALLY", "ALLY FINANCIAL")).toBe(false); // too short to be sure
    expect(sameCreditorName("Credit One Bank", "Lvnv Funding Llc")).toBe(false);
  });
});

describe("Fix 2: charge-offs and rounds", () => {
  it("rounds match the expected result", () => {
    const a = read(caseRows());
    const r = (round: number) => a.negatives.filter((n) => n.round === round).map((n) => n.creditor).sort();
    expect(r(2)).toEqual(["Debt Buyer Llc", "Nations Insuran"]);
    expect(r(3)).toEqual(["Card Bank", "Secured Card Bank"]);
    expect(a.negatives.filter((n) => n.escalationRound === 4).map((n) => n.creditor).sort()).toEqual(["Card Bank", "Secured Card Bank"]);
    expect(neg(a, "Card Bank").kind).toBe("charge_off");
    expect(neg(a, "Secured Card Bank").kind).toBe("charge_off");
    expect(neg(a, "Debt Buyer Llc").kind).toBe("collection");
    expect(neg(a, "Debt Buyer Llc").legalBasis).toMatch(/FDCPA/);
    expect(neg(a, "Card Bank").legalBasis).not.toMatch(/FDCPA/); // FDCPA 809 is for collectors only
  });

  it("Round 3 points: the 'B' code, double reporting and lates a month apart", () => {
    const a = read(caseRows());
    const oc = neg(a, "Card Bank").inconsistencies.join(" | ");
    expect(oc).toMatch(/EX grid shows "B" \(bankruptcy\) 06\/2025 - no bankruptcy on file/);
    expect(oc).toMatch(/still reports \$732 after sale to Debt Buyer Llc \(08\/2025\) - double reporting/);
    expect(oc).toMatch(/lates one month apart/);
    expect(neg(a, "Debt Buyer Llc").inconsistencies.join(" | ")).toMatch(/same \$732 still reported by Card Bank \(double reporting\)/);
  });

  it("a charge-off with no bureau conflict goes straight to Round 4", () => {
    const clean = acct({ creditor: "Store Card", mask: "1111", section: "revolving", bureaus: {
      TU: tl({ dateOpened: "Jan 01, 2022", balance: 400, creditLimit: 500, paymentStatus: "Collection Account", remarks: "CHARGED OFF ACCOUNT" }),
      EQ: tl({ dateOpened: "Jan 01, 2022", balance: 400, creditLimit: 500, paymentStatus: "Collection Account", remarks: "CHARGED OFF ACCOUNT" }),
    } });
    const n = read([clean]).negatives[0];
    expect(n).toMatchObject({ kind: "charge_off", round: 4 });
    expect(n.escalationRound ?? null).toBeNull();
  });

  it("charge-off evidence: remarks (charged off / profit and loss / reported as a loss) or a CO grid cell", () => {
    expect(hasChargeOffEvidence([tl({ remarks: "ACCOUNT CHARGED TO PROFIT AND LOSS" })])).toBe(true);
    expect(hasChargeOffEvidence([tl({ remarks: "UNPAID BALANCE REPORTED AS A LOSS BY CREDIT GRANTOR" })])).toBe(true);
    expect(hasChargeOffEvidence([tl({ remarks: "CHARGED OFF ACCOUNT" })])).toBe(true);
    expect(hasChargeOffEvidence([tl({ gridMarks: ["07/2025:CO"] })])).toBe(true);
    expect(hasChargeOffEvidence([tl({ paymentStatus: "Collection Account", gridMarks: ["07/2025:120"] })])).toBe(false);
  });

  it("a collector stays a collection (Round 2) even with charge-off text; an original creditor with collection status but no charge-off stays Round 3", () => {
    const buyer = acct({ creditor: "Debt Buyer Llc", mask: "9", section: "other", headerStatus: "Original creditor: X BANK", bureaus: { EQ: tl({ balance: 100, paymentStatus: "Collection", remarks: "CHARGED OFF ACCOUNT" }) } });
    expect(negativeKind(buyer, [buyer.bureaus.EQ!])).toBe("collection");
    const oc = acct({ creditor: "Some Bank", mask: "8", section: "revolving", bureaus: { EQ: tl({ balance: 100, paymentStatus: "Collection Account" }) } });
    const n = read([oc]).negatives[0];
    expect(n.kind).toBe("collection");
    expect(n.round).toBe(3);
  });

  it("the 'B' code is not a point when Public Records show a bankruptcy", () => {
    const a = read(caseRows(), { publicRecordsReported: true });
    expect(neg(a, "Card Bank").inconsistencies.join(" ")).not.toMatch(/grid shows "B"/);
  });

  it("lates two months apart, or the same month, are not 'one month apart'", () => {
    const mk = (eq: string, ex: string) =>
      acct({ creditor: "Loan Co", mask: "7", section: "revolving", bureaus: {
        EQ: tl({ balance: 50, late30: 1, gridMarks: [`${eq}:30`] }),
        EX: tl({ balance: 50, late30: 1, gridMarks: [`${ex}:30`] }),
      } });
    expect(read([mk("01/2025", "03/2025")]).negatives[0].inconsistencies.join(" ")).not.toMatch(/one month apart/);
    expect(read([mk("01/2025", "01/2025")]).negatives[0].inconsistencies.join(" ")).not.toMatch(/one month apart/);
    expect(read([mk("01/2025", "02/2025")]).negatives[0].inconsistencies.join(" ")).toMatch(/one month apart/);
  });

  it("no double reporting when the original creditor shows a $0 balance", () => {
    const rows = caseRows();
    for (const b of ["EX", "EQ"] as Bureau[]) rows[1].bureaus[b] = { ...rows[1].bureaus[b]!, balance: 0, pastDue: 0 };
    const a = read(rows);
    expect(neg(a, "Card Bank").inconsistencies.join(" ")).not.toMatch(/double reporting/);
  });

  it("monthly CO codes after a charged-off card closes are not re-aging", () => {
    const a = read(caseRows());
    expect((neg(a, "Secured Card Bank").accuracyFlags ?? []).join(" ")).not.toMatch(/re-aging/);
  });

  it("collections are typed as collections and never count as installment mix", () => {
    const a = read(caseRows());
    expect(neg(a, "Debt Buyer Llc").accountType).toBe("collection");
    expect(neg(a, "Nations Insuran").accountType).toBe("collection");
    const mix = a.fileStrength?.factors?.find((f: { key: string }) => f.key === "installment");
    if (mix) expect(mix.current).toBe(0);
  });

  it("a bureau printing 'Pays as Agreed' on a charged-off account is an accuracy point (Round 3 → 4)", () => {
    const loan = acct({ creditor: "Pay Later Inc", mask: "G0", section: "installment", bureaus: {
      EX: tl({ balance: 30, accountStatus: "Closed", paymentStatus: "Pays as Agreed", remarks: "UNPAID BALANCE REPORTED AS A LOSS BY CREDIT GRANTOR", gridMarks: ["10/2024:CO", "11/2024:CO"] }),
    } });
    const n = read([loan]).negatives[0];
    expect(n.kind).toBe("charge_off");
    expect(n.inconsistencies.join(" ")).toMatch(/EX status "Pays as Agreed" on a charged-off account/);
    expect([n.round, n.escalationRound]).toEqual([3, 4]);
  });
});
