import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { CreditFile } from "./creditFile";
import { FILE, acct, tl } from "./creditAnalysisFixtures";
import { diffCreditFiles } from "./creditFileProgress";
import { generateProgressEnhancementPdf } from "./ofgCreditAnalysisPdf";

/** After a round: Leafy deleted, Jefferson gone from EX only, new late, scores up. */
const AFTER: CreditFile = {
  ...FILE,
  reportDate: "11/05/2026",
  scores: { TU: 548, EX: 590, EQ: null },
  accounts: [
    ...FILE.accounts
      .filter((a) => a.creditor !== "LEAFY FINANCIAL")
      .map((a) =>
        a.creditor === "JEFFERSON CAPITAL" ? { ...a, bureaus: { TU: a.bureaus.TU } } : a,
      ),
    acct({
      creditor: "KLARNA",
      section: "installment",
      bureaus: { TU: tl({ dateOpened: "11/2025", balance: 50, paymentStatus: "Late 30 Days", late30: 1 }) },
    }),
  ],
  inquiries: [
    ...FILE.inquiries,
    { date: "10/20/2026", creditor: "NEW LENDER", bureau: "TU", matchedAccount: false },
  ],
};

async function pdfText(buf: Buffer): Promise<string> {
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: buf }).getText()).text;
}

describe("diffCreditFiles", () => {
  const d = diffCreditFiles(FILE, AFTER);

  it("finds full and partial removals with balances", () => {
    const leafy = d.removed.find((r) => r.creditor === "LEAFY FINANCIAL")!;
    expect(leafy).toMatchObject({ status: "REMOVED", removedFrom: ["TU", "EX"], balance: 435, impact: "HIGH" });
    const jeff = d.removed.find((r) => r.creditor === "JEFFERSON CAPITAL")!;
    expect(jeff).toMatchObject({ status: "PARTIAL", removedFrom: ["EX"], stillOn: ["TU"] });
    expect(d.deletedCount).toBe(1);
    expect(d.balanceRemoved).toBe(435);
  });

  it("counts derogatory listings before → after", () => {
    // Before: 4 negatives × 2 bureaus = 8. After: Eagle 2 + OppLoans 2 + Jefferson 1 + Klarna 1 = 6.
    expect(d.listings).toEqual({ before: 8, after: 6 });
  });

  it("flags what is holding the score back", () => {
    expect(d.newNegatives.map((n) => n.creditor)).toEqual(["KLARNA"]);
    const codes = d.factors.map((f) => `${f.code}:${f.effect}`);
    expect(codes).toContain("deleted:positive");
    expect(codes).toContain("new_inquiries:holding_back");
    expect(codes).toContain("new_negative:holding_back");
  });

  it("keeps per-bureau scores without inventing the missing bureau", () => {
    expect(d.scores.TU).toEqual({ before: 511, after: 548 });
    expect(d.scores.EQ).toEqual({ before: null, after: null });
  });
});

describe("generateProgressEnhancementPdf", () => {
  it("renders the account-detail pages (en + es) that get appended to the existing PDF", async () => {
    const d = diffCreditFiles(FILE, AFTER);
    const en = await generateProgressEnhancementPdf(d, {
      clientName: "Test Client", lang: "en", phone: "(949) 736-5644", site: "optimum-financial-group.com",
    });
    expect((await PDFDocument.load(en)).getPageCount()).toBeGreaterThanOrEqual(1);
    const t = await pdfText(en);
    expect(t).toContain("WHAT CAME OFF YOUR REPORT");
    expect(t).toContain("REMOVED");
    expect(t).toContain("PARTIAL");
    expect(t).toContain("8 -> 6");
    expect(t).toContain("Account detail 1");
    const es = await pdfText(
      await generateProgressEnhancementPdf(d, {
        clientName: "Cliente", lang: "es", phone: "x", site: "y",
      }),
    );
    expect(es).toContain("LO QUE SALIO DE SU REPORTE");
    expect(es).toContain("ELIMINADA");
  });

  it("matches same-creditor accounts one-to-one (one of two Midland collections deleted)", () => {
    const col = (bal: number) =>
      acct({
        creditor: "MIDLAND CREDIT",
        section: "collection",
        bureaus: { TU: tl({ balance: bal, paymentStatus: "Collection" }), EX: tl({ balance: bal, paymentStatus: "Collection" }) },
      });
    const x = diffCreditFiles({ ...FILE, accounts: [col(500), col(900)] }, { ...FILE, accounts: [col(900)] });
    expect(x.deletedCount).toBe(1);
    expect(x.balanceRemoved).toBe(500);
    expect(x.newNegatives).toHaveLength(0);
    expect(x.stillReporting).toHaveLength(1);
  });
});
