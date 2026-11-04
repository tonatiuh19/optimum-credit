/**
 * Permanent regression — every report FORMAT the new engine supports, each a
 * real Claude read (anonymized: name, addresses, account numbers replaced).
 *  - Factual Data tri-merge (lender pull, merged rows, ISO dates)
 *  - Xactus tri-merge (lender pull, merged rows, FICO 2/4/5)
 *  - myFICO 3-Bureau (per-bureau, FICO Score 8, M/YYYY dates)
 *  - MyFreeScoreNow 3B (per-bureau, VantageScore, "Dec 01, 2018" dates,
 *    the same collection printed in two sections)
 *  - SmartCredit Ultra 4K 3B (most uploads; per-bureau, VantageScore)
 *  - IdentityIQ 3B (per-bureau, VantageScore 3.0, payment-grid lates)
 * Universal rules run on all of them; key values were checked by hand
 * against each source PDF. Add a fixture here for every new format or for
 * any report that ever comes out wrong.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { BUREAUS, type CreditFile } from "./creditFile";
import { buildCreditAnalysis, parseReportDate } from "./creditAnalysisFromFile";
import { consolidateSplitAccounts } from "./creditFileExtract";
import { generateOfgCreditAnalysisPdfWithMeta } from "./ofgCreditAnalysisPdf";

const load = (name: string): CreditFile =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "credit-files", name), "utf8"));

const program = {
  standardPrice: "$1,497",
  complexPrice: "$2,497",
  standardUrl: "optimum-financial-group.com/premium-plan-payment",
  complexUrl: "optimum-financial-group.com/complex-repair-payment",
  mfsnUrl: "https://app.myfreescorenow.com/credit-snapshot/29544",
  phone: "(949) 736-5644",
  site: "optimum-financial-group.com",
};

const FORMATS = [
  { name: "Factual Data tri-merge", file: "factual-data-trimerge-active-loan.json", merged: true, activeLoan: true },
  { name: "Xactus tri-merge", file: "xactus-trimerge-active-loan.json", merged: true, activeLoan: true },
  { name: "myFICO 3-Bureau", file: "myfico-3b-score8.json", merged: false, activeLoan: false },
  { name: "MyFreeScoreNow 3B", file: "myfreescorenow-3b.json", merged: false, activeLoan: false },
  { name: "SmartCredit Ultra 3B", file: "smartcredit-ultra-3b.json", merged: false, activeLoan: false },
  { name: "IdentityIQ 3B", file: "identityiq-3b.json", merged: false, activeLoan: false },
] as const;

describe.each(FORMATS)("universal rules — $name", ({ file, merged, activeLoan }) => {
  const f = load(file);
  const a = buildCreditAnalysis(f);

  it("reads the format, a borrower name and at least one score", () => {
    expect(f.reportFormat).toBe(merged ? "merged" : "per_bureau");
    expect(a.borrowerName).toMatch(/SAMPLE/);
    expect(BUREAUS.some((b) => a.scores[b] !== null)).toBe(true);
    expect(parseReportDate(f.reportDate)).not.toBeNull();
  });

  it("every open date parses (avg age + oldest exist)", () => {
    const opened = f.accounts.flatMap((x) => BUREAUS.map((b) => x.bureaus[b]?.dateOpened).filter(Boolean));
    expect(opened.every((d) => parseReportDate(d!) !== null)).toBe(true);
    expect(a.totals!.avgAgeMonths).not.toBeNull();
    expect(a.totals!.oldest).not.toBeNull();
  });

  it("positives are never dispute targets; every negative has a round + legal basis", () => {
    const pos = new Set(a.positives.map((p) => `${p.creditor}|${p.opened}|${p.mask}`));
    expect(a.negatives.some((n) => pos.has(`${n.creditor}|${n.opened}|${n.mask}`))).toBe(false);
    expect(a.accuracyUpdates).toEqual([]);
    for (const n of a.negatives) {
      expect([1, 2, 3, 4]).toContain(n.round);
      expect(n.legalBasis).toMatch(/FCRA|FDCPA/);
    }
  });

  it("an account with late counts or a charge-off / collection is never positive (P0-8)", () => {
    for (const p of a.positives) {
      const acct = f.accounts.find((x) => x.creditor === p.creditor && x.mask === p.mask)!;
      const tls = BUREAUS.map((b) => acct.bureaus[b]).filter(Boolean);
      expect(tls.some((t) => (t!.late30 ?? 0) + (t!.late60 ?? 0) + (t!.late90 ?? 0) > 0)).toBe(false);
      expect(tls.some((t) => /charge.?off|collection/i.test(`${t!.paymentStatus} ${t!.accountStatus}`))).toBe(false);
    }
  });

  it("bureau tags only come from the source; unlabeled inquiries stay Not itemized", () => {
    for (const q of a.inquiries) {
      const src = f.inquiries.find((x) => x.creditor === q.creditor && x.date === q.date && x.bureau === q.bureau);
      expect(src).toBeDefined();
    }
    for (const n of a.negatives) {
      const acct = f.accounts.find((x) => x.creditor === n.creditor && x.mask === n.mask)!;
      for (const b of n.bureaus) expect(acct.bureaus[b]).toBeDefined();
    }
  });

  it(`active loan ${activeLoan ? "detected: lender inquiry excluded, primary line held" : "not claimed"}`, () => {
    expect(a.escrow.active).toBe(activeLoan);
    if (activeLoan) {
      expect(a.inquiries.some((q) => q.action === "dispute" && q.excludedReason === "active_loan")).toBe(false);
      const primary = a.tradelines.find((t) => t.code === "primary");
      if (primary) expect(primary.timing).toBe("hold");
    }
  });

  it("projections: middle score never goes down, +100 cap, never past 760", () => {
    let prev = -1;
    for (const p of a.projections) {
      if (p.middle != null) {
        expect(p.middle).toBeGreaterThanOrEqual(prev);
        prev = p.middle;
      }
      for (const b of BUREAUS) {
        const cur = a.scores[b];
        const v = p.scores[b];
        if (cur === null || v === null) continue;
        expect(v).toBeLessThanOrEqual(Math.max(cur, 760));
        expect(v - cur).toBeLessThanOrEqual(100);
      }
    }
  });

  it("the client PDF is exactly 5 pages", async () => {
    const { buffer, pages } = await generateOfgCreditAnalysisPdfWithMeta(a, { clientName: "Sample", lang: "en", program });
    expect(pages).toBe(5);
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(5);
  }, 30_000);
});

describe("format specifics (checked against each source PDF)", () => {
  it("Xactus: lender Statewide, FICO 2/4/5, totals reconcile; late tallies differ by provider (note, not a block)", () => {
    const a = buildCreditAnalysis(load("xactus-trimerge-active-loan.json"));
    expect(a.scores).toEqual({ TU: 550, EX: 622, EQ: 594 });
    expect(a.middleScore).toBe(594);
    expect(a.escrow).toMatchObject({ active: true, source: "lender_report", lenderName: "STATEWIDE" });
    expect(a.totals).toMatchObject({ tradelines: 25, totalBalance: 10945, pastDue: 6688 });
    const lates = a.selfCheck!.items.find((i) => i.key === "lates")!;
    expect(lates.ok).toBe(false);
    expect(lates.blocking).toBe(false);
    // This fixture was read before EQX (Xactus Equifax code) was recognized: EQ has a score but 0
    // accounts. Spec v2.3 §7 bureau coverage must hold it for review (Laila, Oct 26).
    const coverage = a.selfCheck!.items.find((i) => i.key === "bureau_coverage")!;
    expect(coverage.ok).toBe(false);
    expect(a.selfCheck!.ok).toBe(false);
    // Collections are third-party (R2) and a collection's later activity is never "re-aging".
    const r2 = a.negatives.filter((n) => n.round === 2);
    expect(r2.map((n) => n.creditor).sort()).toEqual(["CAVALRY PORTFOLIO SERV", "DNF ASSOC", "FIDELITY CREDITOR SERV", "LVNV FUNDING LLC"]);
    expect(r2.every((n) => !(n.accuracyFlags ?? []).some((x) => /re-aging/.test(x)))).toBe(true);
    // Timeshare with a FORECLOSURE remark → Round 4, Complex program.
    expect(a.negatives.find((n) => /MARRIOTT/.test(n.creditor))!.round).toBe(4);
    expect(a.programTier).toBe("complex");
    // Resolved dispute remark on a positive account → informational only.
    expect(a.informational!.some((i) => i.creditor === "CITI")).toBe(true);
  });

  it("myFICO: FICO Score 8 per bureau, M/YYYY dates, verified/resolved dispute held", () => {
    const a = buildCreditAnalysis(load("myfico-3b-score8.json"));
    expect(a.scores).toEqual({ TU: 510, EX: 545, EQ: 559 });
    expect(a.middleScore).toBe(545);
    expect(a.escrow.active).toBe(false);
    expect(a.negatives.find((n) => n.kind === "charge_off")?.round).toBe(4);
    expect(a.negatives.some((n) => n.hold)).toBe(true);
    expect(a.programTier).toBe("standard");
  });

  it("MyFreeScoreNow: month-name dates; the same collection in two sections is ONE account", () => {
    const f = load("myfreescorenow-3b.json");
    const a = buildCreditAnalysis(f);
    expect(a.scores).toEqual({ TU: 618, EX: 628, EQ: 624 });
    expect(parseReportDate("Dec 01, 2018")?.toISOString().slice(0, 10)).toBe("2018-12-01");
    expect(parseReportDate("August 7, 2026")?.toISOString().slice(0, 10)).toBe("2026-08-07");
    expect(a.totals!.tradelines).toBe(18);
    // Each third-party collection is reported by all three bureaus as one account.
    const lvnv = a.negatives.filter((n) => /lvnv/i.test(n.creditor));
    expect(lvnv).toHaveLength(3);
    expect(lvnv.every((n) => n.round === 2 && n.bureaus.length === 3)).toBe(true);
    // Consolidation is idempotent.
    expect(consolidateSplitAccounts(f.accounts)).toHaveLength(18);
  });

  it("SmartCredit: scores, one late account in Round 3, old Advantage pulls stay Round 1 targets", () => {
    const a = buildCreditAnalysis(load("smartcredit-ultra-3b.json"));
    expect(a.scores).toEqual({ TU: 664, EX: 659, EQ: 665 });
    expect(a.negatives.map((n) => [n.creditor, n.round])).toEqual([["BRCLYSBANKDE", 3]]);
    expect(a.inquiries.filter((q) => q.action === "dispute").length).toBe(4);
    expect(a.escrow.active).toBe(false);
  });

  it("IdentityIQ: third-party collection R2, original-creditor collections R3, active dispute held", () => {
    const a = buildCreditAnalysis(load("identityiq-3b.json"));
    expect(a.scores).toEqual({ TU: 473, EX: 505, EQ: 513 });
    expect(a.negatives.filter((n) => n.round === 2).map((n) => n.creditor)).toEqual(["ALLIED ACCT"]);
    expect(a.negatives.find((n) => n.creditor === "TARGET/TD")!.round).toBe(3);
    expect(a.negatives.find((n) => n.creditor === "AMEX/CBNA")!.hold).toBe(true);
    expect(a.inquiries.some((q) => q.lowerOdds)).toBe(true);
  });
});
