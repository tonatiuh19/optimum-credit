/**
 * Engine rules from Cesar's review (Oct 22 2026) — apply to EVERY report:
 *  1. Exclude any inquiry matching an account opened within ~90 days,
 *     incl. lender/dealer pairs (Carvana → Bridgecrest).
 *  2. One derogatory date per account (first late on the payment grid),
 *     the same in every section.
 *  3. File overview built per bureau (EQ / EX / TU), never combined.
 *  4. Addresses / names normalized and de-duplicated before listing.
 *  5. Phone + site set once (OFG_REPORT_CONTACT) for every report.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { CreditFile } from "./creditFile";
import { buildCreditAnalysis, derogDateProxy, normalizeIdentityFlags, parseReportDate as parseReportDateForTest } from "./creditAnalysisFromFile";
import { OFG_REPORT_CONTACT, generateOfgCreditAnalysisPdf } from "./ofgCreditAnalysisPdf";

const load = (name: string): CreditFile =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "credit-files", name), "utf8"));
const FIXTURES = fs.readdirSync(path.join(__dirname, "fixtures", "credit-files")).filter((f) => f.endsWith(".json"));

async function pdfText(buf: Buffer): Promise<string> {
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
}

const program = {
  standardPrice: "$1,497",
  complexPrice: "$2,497",
  standardUrl: OFG_REPORT_CONTACT.standardUrl,
  complexUrl: OFG_REPORT_CONTACT.complexUrl,
  mfsnUrl: null,
  phone: OFG_REPORT_CONTACT.phone,
  site: OFG_REPORT_CONTACT.site,
};

describe("1. inquiries matching a newly opened account are excluded", () => {
  it("Carvana → Bridgecrest (dealer / lender pair) is excluded, not a Round 1 target", () => {
    const a = buildCreditAnalysis(load("factual-data-trimerge-active-loan.json"));
    const carvana = a.inquiries.find((q) => /carvana/i.test(q.creditor))!;
    expect(carvana.action).toBe("permissible");
    expect(carvana.excludedReason).toBe("matches_account");
  });

  it.each(FIXTURES)("%s: no dispute-target inquiry has an account opened within 90 days from the same lender", (name) => {
    const a = buildCreditAnalysis(load(name));
    for (const q of a.inquiries.filter((x) => x.action === "dispute")) expect(q.lowerOdds ?? null).toBeNull();
  });
});

describe("2. one derogatory date per account, the same in every section", () => {
  it.each(FIXTURES)("%s", (name) => {
    const a = buildCreditAnalysis(load(name));
    for (const n of a.negatives) {
      if (n.derogDateIsProxy) continue;
      // Page 2 status quotes the same first-late date page 3 sorts and prints.
      expect(n.status).toContain(`first late ${n.derogDate}`);
    }
  });
});

describe("3. overview per bureau (EQ / EX / TU)", () => {
  it("PDF page 1 has Equifax / Experian / TransUnion columns", async () => {
    const a = buildCreditAnalysis(load("myfico-3b-score8.json"));
    const text = await pdfText(await generateOfgCreditAnalysisPdf(a, { clientName: "S", lang: "en", program }));
    expect(text).toMatch(/Metric Equifax Experian TransUnion Accounts \d+ \d+ \d+/);
    expect(text).toMatch(/Positive \/ negative \d+ \/ \d+ \d+ \/ \d+ \d+ \/ \d+/);
  });
});

describe("4. personal info normalized + de-duplicated", () => {
  it("an address on every bureau is not a variance; repeats are listed once", () => {
    const flags = normalizeIdentityFlags([
      { bureau: "EQ", field: "address", detail: "•••TH ST, DOWNEY, CA •••; •••S CENTRE ST, SAN PEDRO, CA •••" },
      { bureau: "TU", field: "address", detail: "•••TH ST, DOWNEY, CA •••; DALLAS TX, DALLAS, TX •••" },
      { bureau: "EX", field: "address", detail: "•••th st., Downey, CA •••; •••NAPA WY, PALMDALE, CA •••" },
      { bureau: "TU", field: "name", detail: "ALMA RICE" },
      { bureau: "EQ", field: "name", detail: "ALMA YVETTE RICE" },
      { bureau: "EX", field: "name", detail: "ALMA YVETTE RICE" },
    ]);
    const addr = flags.filter((f) => f.field === "address").map((f) => f.detail);
    expect(addr.some((d) => /DOWNEY/i.test(d))).toBe(false); // on all 3 → consistent
    expect(addr).toHaveLength(3); // San Pedro, Dallas, Palmdale — once each
    expect(new Set(addr).size).toBe(addr.length);
    const names = flags.filter((f) => f.field === "name");
    expect(names).toEqual([
      { bureau: "TU", field: "name", detail: "ALMA RICE" },
      { bureau: "EQ", field: "name", detail: "ALMA YVETTE RICE" },
      { bureau: "EX", field: "name", detail: "ALMA YVETTE RICE" },
    ]);
  });
});

describe("5. phone + site set once", () => {
  it("OFG_REPORT_CONTACT is the new number, site and address", () => {
    expect(OFG_REPORT_CONTACT).toEqual({
      phone: "(949) 674-0714",
      site: "ofgllc.com",
      address: "2717 W Coast Hwy, Ste C, Newport Beach, CA 92663",
      // Remaining Fixes R-5: OFG redirect links → program pages on optimum-financial-group.com.
      standardUrl: "https://www.ofgllc.com/go/enroll-standard",
      complexUrl: "https://www.ofgllc.com/go/enroll-complex",
      freeScoreUrl: "https://www.ofgllc.com/go/free-score",
    });
  });

  it("the analysis PDF footer + enrollment link use it, never the old number / site", async () => {
    const a = buildCreditAnalysis(load("factual-data-trimerge-active-loan.json"));
    const text = await pdfText(await generateOfgCreditAnalysisPdf(a, { clientName: "S", lang: "en", program }));
    expect(text).toContain("(949) 674-0714");
    expect(text).toContain("https://www.ofgllc.com/go/enroll-complex");
    // The contact line stays (949) 674-0714 / ofgllc.com; only the enrollment link uses the program domain (R-5).
    expect(text).not.toMatch(/736-5644/);
  });

  it("no report module hard-codes the old contact", () => {
    for (const f of ["ofgCreditAnalysisPdf.ts", "progressReportV2.ts", "creditAnalysisFromFile.ts", "creditFileProgress.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src, f).not.toMatch(/736-5644/);
    }
  });
});

describe("presentation consistency (audit, Oct 22)", () => {
  it("the verified legal name is never a name variance; only a real error on one bureau is (v2.4 #7)", () => {
    const flags = normalizeIdentityFlags(
      [
        { bureau: "EQ", field: "name", detail: "ALMA YVETTE RICE" },
        { bureau: "EX", field: "name", detail: "ALMA YVETTE RICE" },
        { bureau: "TU", field: "name", detail: "ALMA RICE; AKA: ALMA RYCE" },
      ],
      "ALMA YVETTE RICE",
    );
    // "ALMA RICE" (middle name left out) is a normal format; "RYCE" is a misspelling.
    expect(flags).toEqual([{ bureau: "TU", field: "name", detail: "ALMA RYCE" }]);
  });

  it("medical collections drive Complex even when the 'original creditor' is a category tag", () => {
    const a = buildCreditAnalysis(load("factual-data-trimerge-active-loan.json"));
    const ic = a.negatives.find((n) => /I\.C\. SYSTEM/.test(n.creditor))!;
    expect(ic.medical).toBe(true);
    expect(ic.originalCreditor).toBeNull(); // "MEDICAL PAYMENT DATA" is not a creditor
    expect(a.programTier).toBe("complex");
  });

  it("money is formatted and raw status codes are readable", () => {
    const a = buildCreditAnalysis(load("factual-data-trimerge-active-loan.json"));
    const gm = a.negatives.find((n) => n.creditor === "GM FINANCIAL")!;
    expect(gm.status).toMatch(/Charge-off/);
    expect(gm.status).toMatch(/\$29,108 past due/);
    expect(gm.status).not.toMatch(/ChargeOff|\$29108/);
  });

  it.each(FIXTURES)("%s: every date in the PDF uses one style (no ISO / month names)", async (name) => {
    const a = buildCreditAnalysis(load(name));
    const text = await pdfText(await generateOfgCreditAnalysisPdf(a, { clientName: "S", lang: "en", program }));
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(text).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, 20\d\d\b/);
  });
});

describe("6. derogatory date never uses a re-dated value (Cesar, Oct 22 — OneMain)", () => {
  const tl = (o: Record<string, unknown>) => ({ closedDate: null, dateLastActivity: null, dateLastDelinquent: null, ...o }) as never;

  // Spec v2.3 P1-4 supersedes the Oct 22 closed-date fallback: earlier of DLA and Date Opened, never Closed / Paid.
  it("re-aged charge-off: closed 02/29/2024, re-dated 09/29/2026 → the open date, never 09/2026 or the closed date", () => {
    expect(derogDateProxy([tl({ closedDate: "02/29/2024", dateLastActivity: "2026-09-29" })], "charge_off", "2022-03-07")).toBe("2022-03-07");
  });
  it("Date Last Delinquent wins when printed (and not after the closed date)", () => {
    expect(derogDateProxy([tl({ dateLastDelinquent: "2023-12-01", closedDate: "02/29/2024", dateLastActivity: "2026-09-29" })], "charge_off", null)).toBe("2023-12-01");
    // A 'last delinquent' / last activity after the closed date is re-dated → ignored; nothing left = not itemized.
    expect(derogDateProxy([tl({ dateLastDelinquent: "2026-08-01", closedDate: "02/29/2024", dateLastActivity: "2026-09-29" })], "charge_off", null)).toBeNull();
  });
  it("collection: placement date beats later activity", () => {
    expect(derogDateProxy([tl({ dateLastActivity: "08/01/2026" })], "collection", "09/25/2024")).toBe("09/25/2024");
  });
  it("Alma's OneMain on the real fixture is dated 02/2024 or earlier", () => {
    const a = buildCreditAnalysis(load("factual-data-trimerge-active-loan.json"));
    const om = a.negatives.find((n) => n.creditor === "ONEMAIN")!;
    expect(new Date(String(parseReportDateForTest(om.derogDate))).getTime()).toBeLessThanOrEqual(Date.UTC(2024, 1, 29));
  });
  it.each(FIXTURES)("%s: no negative is dated after its own closed date", (name) => {
    const f = load(name);
    const a = buildCreditAnalysis(f);
    for (const n of a.negatives) {
      const acct = f.accounts.find((x) => x.creditor === n.creditor && x.mask === n.mask)!;
      const closed = Object.values(acct.bureaus)
        .map((t) => parseReportDateForTest(t?.closedDate))
        .filter((x): x is Date => !!x)
        .sort((x, y) => x.getTime() - y.getTime())[0];
      const d = parseReportDateForTest(n.derogDate);
      if (closed && d && !/\d{2}\/\d{4}$/.test(String(n.derogDate))) expect(d.getTime()).toBeLessThanOrEqual(closed.getTime());
    }
  });
});
