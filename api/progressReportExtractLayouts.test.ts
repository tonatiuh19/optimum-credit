/**
 * Critical layout + WinAnsi matrix for OFG Progress Report score extract / PDF.
 * These patterns are provider/layout-driven (not client-specific).
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { OfGReportData } from "../shared/api";
import {
  buildConfidence,
  detectProvider,
  extractAllScores,
  extractReportDate,
  middleScore,
  toPdfSafeText,
} from "./index";
import { generateProgressReportV2Pdf, pv2BuildPdfData, pv2Diff } from "./progressReportV2";

function expectScores(
  text: string,
  expected: { tu: number | null; ex: number | null; eq: number | null },
  provider?:
    | "smartcredit"
    | "identityiq"
    | "myscoreiq"
    | "myfreescore"
    | "myfico"
    | "generic",
) {
  const scores = extractAllScores(text, provider);
  expect(scores.transunion).toBe(expected.tu);
  expect(scores.experian).toBe(expected.ex);
  expect(scores.equifax).toBe(expected.eq);
}

describe("progress report extract — layout matrix (all clients)", () => {
  it("parses Three Bureau / Equifax1 interleaved score blocks (Maria)", () => {
    const text = `
Three Bureau Credit Report
Credit Score and Rating
Equifax1
576
Fair
Experian2
580
Fair
TransUnion3
561
Fair
Factors affecting your credit score
`;
    expectScores(
      text,
      { tu: 561, ex: 580, eq: 576 },
      "identityiq",
    );
  });

  it("parses Three Bureau R2/R3 score progression", () => {
    expectScores(
      `Equifax1\n624\nFair\nExperian2\n628\nFair\nTransUnion3\n618\nFair`,
      { tu: 618, ex: 628, eq: 624 },
    );
    expectScores(
      `Equifax1\n629\nFair\nExperian2\n629\nFair\nTransUnion3\n623\nFair`,
      { tu: 623, ex: 629, eq: 629 },
    );
  });

  it("does not treat Equifax Accounts Summary as a score label", () => {
    expectScores(
      `
Equifax Accounts Summary
Your credit report includes information
Equifax Experian TransUnion
Report Date June 27, 2026 June 27, 2026 June 27, 2026
`,
      { tu: null, ex: null, eq: null },
    );
  });

  it("SmartCredit Ultra 3B: stacked ® headers + tab score row (with util noise above)", () => {
    const text = `
SmartCredit Report
TOTAL CREDIT USED \tTOTAL AVAILABLE CREDIT \tOVERALL UTILIZATION
TransUnion \t$153 \t$300 \t51%
Experian \t$208 \t$300 \t69%
Equifax \t$153 \t$300 \t51%
Positive Accounts 20
CAP1/KOHLS 639305****
Open Bank High Utilization Differences $ 1
TransUnion®\t
Experian®\t
Equifax®
576 \t567 \t545
TransUnion \tExperian \tEquifax
BRIAN A AVELAR \tBRIAN AVELAR \tBRIAN A AVELAR
1992 \t1992 \t1992
`;
    expectScores(text, { tu: 576, ex: 567, eq: 545 }, "smartcredit");
  });

  it("myFICO 3B printable: EQ/TU/EX header + glued 559Poor cells (Score 8 summary)", () => {
    // Real pdf-parse layout from secure.myfico.com 3-Bureau printable.
    const text = `
PREPARED FOR
Martin Morales
FICO® SCORE 3B REPORT
AS OF 8/25/2026
9/15/26, 3:50 AM \tmyFICO 3-Bureau Report - 8/25/2026 | Martin Morales
https://secure.myfico.com/member/#/reports/three/printable

EQUIFAX \tTRANSUNION \tEXPERIAN
559Poor
300 850
510Poor
300 850
545Poor
300 850
REVOLVING UTILIZATION %
EQUIFAX \tTRANSUNION \tEXPERIAN

Most widely used version.
Equifax \tTransUnion \tExperian
8/25/2026
503Poor
250 900
8/25/2026
482Poor
250 900
8/25/2026
474Poor
250 900
`;
    expect(detectProvider(text)).toBe("myfico");
    expectScores(text, { tu: 510, ex: 545, eq: 559 }, "myfico");
    expect(extractReportDate(text)).toBe("2026-08-25");
  });

  it("myFICO: spaced rating (559 Poor) and rejects date-prefixed later model blocks", () => {
    const text = `
myFICO 3-Bureau Report
FICO® SCORE 3B REPORT
EQUIFAX TRANSUNION EXPERIAN
559 Poor
300 850
510 Fair
300 850
545 Poor
300 850
REVOLVING UTILIZATION %
Equifax TransUnion Experian
8/25/2026
503Poor
250 900
8/25/2026
482Poor
250 900
8/25/2026
474Poor
250 900
`;
    expectScores(text, { tu: 510, ex: 545, eq: 559 });
  });

  it("does not treat generic 'my FICO' prose as myfico provider", () => {
    expect(detectProvider("Tips to improve my FICO score this year")).toBe(
      "generic",
    );
  });

  it("detects MyFreeScoreNow Three Bureau as myfreescore", () => {
    expect(
      detectProvider(
        "Three Bureau Credit Report powered by Equifax\nVantageScore\nEquifax1\n624\nFair",
      ),
    ).toBe("myfreescore");
  });

  it("a client SmartCredit Ultra 3B: stacked scores + triplicated Credit Report Date", () => {
    const text = `
Credit Scores
Credit Report Date
TOTAL CREDIT USED \tTOTAL AVAILABLE CREDIT \tOVERALL UTILIZATION
TransUnion \t$2,430 \t$4,800 \t51%
Experian \t$2,430 \t$4,800 \t51%
Equifax \t$2,430 \t$4,800 \t51%
Positive Accounts 20
TransUnion®
Experian®
Equifax®
538 \t549 \t539
TransUnion \tExperian \tEquifax
CARLOS A RODRIGUEZ \tCARLOS ALBERTO RODRIGUEZ \tCARLOS RODRIGUEZ
08/18/2026 \t08/18/2026 \t08/18/2026
`;
    expectScores(text, { tu: 538, ex: 549, eq: 539 }, "smartcredit");
    expect(extractReportDate(text)).toBe("2026-08-18");
  });

  it("Maria MFSN Three Bureau: Equifax1 interleaved blocks + Report Date", () => {
    const text = `
Three Bureau Credit Report powered by Equifax
Maria Ramos | August 07, 2026
Credit Score and Rating
Equifax1
624
Fair
Experian2
628
Fair
TransUnion3
618
Fair
Factors affecting your credit score
Report Date August 07, 2026 August 07, 2026 August 07, 2026
`;
    expectScores(text, { tu: 618, ex: 628, eq: 624 }, "myfreescore");
    expect(detectProvider(text)).toBe("myfreescore");
    expect(extractReportDate(text)).toBe("2026-08-07");
  });

  it("prefers stacked columns when TU===EX clone with different EQ", () => {
    const text = `
TransUnion Score: 376
Experian Score: 376
Equifax Score: 538
TransUnion®
Experian®
Equifax®
538 \t549 \t539
`;
    expectScores(text, { tu: 538, ex: 549, eq: 539 }, "smartcredit");
  });

  it("SmartCredit Ultra 3B: $1,348 util must not become score 348 (Elizabeth)", () => {
    // Real pdf-parse layout: comma thousands in TOTAL CREDIT USED bleed into
    // labeled extract via \\b between "," and "3" → false 348 scores.
    const text = `
Credit Scores
Credit Utilization
TOTAL CREDIT USED \tTOTAL AVAILABLE CREDIT \tOVERALL UTILIZATION
TransUnion \t$1,348 \t$7,201 \t19%
Experian \t$1,348 \t$2,201 \t61%
Equifax \t$1,348 \t$5,200 \t26%
Positive Accounts 21
PARTNERSCU 404636****
Open Credit Union Credit Card
TransUnion®\t
Experian®\t
Equifax®
611 \t611 \t613
TransUnion \tExperian \tEquifax
ELIZABETH CHRISTENSEN \tELIZABETH CHRISTENSEN \tELIZABETH CHRISTENSEN
1969 \t1969 \t1969
05/22/2026 \t05/22/2026 \t05/22/2026
`;
    expectScores(text, { tu: 611, ex: 611, eq: 613 }, "smartcredit");
  });

  it("SmartCredit Ultra 3B round-after row", () => {
    expectScores(
      `TransUnion®\nExperian®\nEquifax®\n583 \t548 \t517`,
      { tu: 583, ex: 548, eq: 517 },
      "smartcredit",
    );
  });

  it("stacked headers with space-separated scores", () => {
    expectScores(
      `TransUnion\nExperian\nEquifax\n640 655 630`,
      { tu: 640, ex: 655, eq: 630 },
    );
  });

  it("stacked headers with Vantage/FICO label between names and numbers", () => {
    expectScores(
      `
TransUnion®
Experian®
Equifax®
VantageScore 3.0
Fair
612 598 605
`,
      { tu: 612, ex: 598, eq: 605 },
      "identityiq",
    );
  });

  it("stacked headers in non-default order (EQ / EX / TU)", () => {
    expectScores(
      `Equifax\nExperian\nTransUnion\n500 510 520`,
      { tu: 520, ex: 510, eq: 500 },
    );
  });

  it("horizontal tri-merge header row still preferred", () => {
    expectScores(
      `
Credit Scores
TransUnion Experian Equifax
650 680 620
`,
      { tu: 650, ex: 680, eq: 620 },
    );
  });

  it("abbreviated horizontal TU EX EQ", () => {
    expectScores(
      `TU EX EQ\n601 612 598`,
      { tu: 601, ex: 612, eq: 598 },
    );
  });

  it("inline same-line labels", () => {
    expectScores(
      `TransUnion 640 Experian 655 Equifax 630`,
      { tu: 640, ex: 655, eq: 630 },
    );
  });

  it("per-line FICO labels (classic SmartCredit)", () => {
    expectScores(
      `
SmartCredit Report
TransUnion FICO Score 603
Experian FICO Score 632
Equifax FICO Score 551
`,
      { tu: 603, ex: 632, eq: 551 },
      "smartcredit",
    );
  });

  it("IdentityIQ Score: labels", () => {
    expectScores(
      `
TransUnion Score: 612
Experian Score: 598
Equifax Score: 605
`,
      { tu: 612, ex: 598, eq: 605 },
      "identityiq",
    );
  });

  it("does not treat utilization $300 rows as scores", () => {
    const text = `
TOTAL CREDIT USED TOTAL AVAILABLE CREDIT OVERALL UTILIZATION
TransUnion $153 $300 51%
Experian $208 $300 69%
Equifax $153 $300 51%
Positive Accounts 20
`;
    expectScores(text, { tu: null, ex: null, eq: null }, "smartcredit");
  });

  it("prefers real score cues over $500 balances (Lecca/Alex Sanchez class)", () => {
    expectScores(
      `
TransUnion
High Balance $500
Past Due 0
Credit Score 515
Experian
High Balance $500
Score: 596
Equifax
High Balance: 500.00
VantageScore 602
`,
      { tu: 515, ex: 596, eq: 602 },
    );
  });

  it("rejects identical junk 500s without score context", () => {
    expectScores(
      `
TransUnion Account CAPITAL ONE High Balance 500 Payment Status
Experian Account CAPITAL ONE High Balance 500 Payment Status
Equifax Account CAPITAL ONE High Balance 500 Payment Status
`,
      { tu: null, ex: null, eq: null },
    );
  });

  it("keeps legitimate identical tri-bureau scores", () => {
    expectScores(
      `
TransUnion Credit Score 640
Experian Credit Score 640
Equifax Credit Score 640
`,
      { tu: 640, ex: 640, eq: 640 },
    );
  });

  it("two-bureau stacked only (missing Equifax)", () => {
    expectScores(
      `TransUnion®\nExperian®\n610 620`,
      { tu: 610, ex: 620, eq: null },
    );
  });

  it("ignores DOB/year rows under name columns (1992 trap)", () => {
    const text = `
TransUnion®
Experian®
Equifax®
576 567 545
TransUnion Experian Equifax
BRIAN A AVELAR BRIAN AVELAR BRIAN A AVELAR
1992 1992 1992
`;
    expectScores(text, { tu: 576, ex: 567, eq: 545 }, "smartcredit");
  });

  it("out-of-range scores rejected; boundary 300/850 kept", () => {
    expectScores(
      `TransUnion Score: 250\nExperian Score: 900\nEquifax Score: 700`,
      { tu: null, ex: null, eq: 700 },
      "identityiq",
    );
    expectScores(
      `TransUnion Score: 300\nExperian Score: 850\nEquifax Score: 500`,
      { tu: 300, ex: 850, eq: 500 },
      "identityiq",
    );
  });

  it("middle score uses median of available bureaus", () => {
    const scores = extractAllScores(
      `TransUnion®\nExperian®\nEquifax®\n576 567 545`,
      "smartcredit",
    );
    expect(middleScore(scores)).toBe(567);
  });

  it("confidence is high when all three bureaus present", () => {
    const conf = buildConfidence(
      { transunion: 576, experian: 567, equifax: 545 },
      { transunion: 583, experian: 548, equifax: 517 },
    );
    expect(conf.transunion).toBeGreaterThanOrEqual(0.8);
    expect(conf.experian).toBeGreaterThanOrEqual(0.8);
    expect(conf.equifax).toBeGreaterThanOrEqual(0.8);
  });

  it("confidence stays low when a bureau is missing", () => {
    const conf = buildConfidence(
      { transunion: null, experian: null, equifax: 576 },
      { transunion: null, experian: null, equifax: 583 },
    );
    expect(conf.transunion).toBeLessThan(0.6);
    expect(conf.experian).toBeLessThan(0.6);
  });
});

describe("progress report PDF — WinAnsi / control-char matrix", () => {
  it("toPdfSafeText yields WinAnsi-safe single-line text", () => {
    const samples = [
      "Credit Card\tNegative",
      "A → B — C • D",
      "Utilización / Crédito",
      "Line\nTwo\r\nThree",
      "emoji ✅ done",
      "\u0000null\u0008byte",
    ];
    for (const s of samples) {
      const out = toPdfSafeText(s);
      expect(out).not.toMatch(/[\t\r\n]/);
      expect(out).toMatch(/^[\x20-\x7E\xA0-\xFF]*$/);
    }
  });

  // Engine Spec v1: the published PDF always comes from the account-level
  // engine; these keep the WinAnsi / control-char guarantees on that path.
  const tl = (o: Record<string, unknown>) => ({
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: null,
    dateOpened: "01/2018", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
    creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
    lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [], ...o,
  }) as any;
  const file = (date: string, scores: Record<string, number>, accounts: any[]) =>
    ({ provider: "smartcredit", reportDate: date, scores, accounts, inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [] }) as any;
  const accts = (withColl: boolean) => [
    { creditor: "Médico\tABC — Colección", mask: "1234", section: "collection", headerStatus: null, confident: true,
      bureaus: withColl ? { TU: tl({ paymentStatus: "Collection", balance: 500 }) } : {} },
    { creditor: "Tarjeta “Óptima”\u0007", mask: "9999", section: "revolving", headerStatus: null, confident: true,
      bureaus: { TU: tl({ creditLimit: 2000, balance: 900, accountType: "Credit Card" }), EX: tl({ creditLimit: 2000, balance: 900 }) } },
  ];
  const build = (lang: "en" | "es") => {
    const diff = pv2Diff(file("01/01/2026", { TU: 580, EX: 590, EQ: 600 }, accts(true)), file("06/01/2026", { TU: 620, EX: 630, EQ: 640 }, accts(false)), lang);
    return pv2BuildPdfData({
      diff, clientFirstName: "José", clientName: "José García\tPérez", round: 2, lang,
      scores: { TU: { before: 580, after: 620 }, EX: { before: 590, after: 630 }, EQ: { before: 600, after: 640 } },
      phone: "(949) 674-0714", site: "ofgllc.com", address: "2717 W Coast Hwy, Ste C, Newport Beach, CA 92663",
    });
  };

  it("generates PDF when names contain tabs / unicode / control chars", async () => {
    const buffer = await generateProgressReportV2Pdf(build("en"));
    expect(buffer.length).toBeGreaterThan(2000);
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(3);
  });

  it("Spanish locale PDF with accents still builds", async () => {
    const buffer = await generateProgressReportV2Pdf(build("es"));
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(3);
  });
});
