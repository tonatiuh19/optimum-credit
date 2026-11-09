/**
 * Acceptance — Progress Report Engine Fix Spec v1 (Cesar, Oct 22 2026) §8:
 * a client Fernando Huiza, SmartCredit 3-bureau, 08/06/2026 → 10/07/2026.
 * Fixture = the spec's own values (no name / SSN / address beyond the first
 * name). It also carries the template / TOC rows the old text path published
 * ("10. Collections 53", "30 Days", "Included in - Bankruptcy") to prove they
 * never become items. Permanent regression.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import {
  generateProgressReportV2Pdf,
  pv2AccuracyFlags,
  pv2BuildPdfData,
  pv2CleanRemarks,
  pv2DataIntegrity,
  pv2NoChangesYet,
  pv2DelinquencyMonths,
  pv2Diff,
  pv2IsJunkItem,
  pv2SanitizeFile,
  pv2SelfCheck,
  pv2Validate,
  type Pv2RenderStats,
} from "./progressReportV2";
import { caseHygieneAlerts, progressReportFileName } from "./index";

function tl(o: Partial<BureauTradeline>): BureauTradeline {
  return {
    accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: null,
    dateOpened: "01/2019", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
    creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
    lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
    late30: 0, late60: 0, late90: 0, gridMarks: [],
    ...o,
  };
}
const all3 = (f: (b: Bureau) => BureauTradeline): Partial<Record<Bureau, BureauTradeline>> => ({ EQ: f("EQ"), EX: f("EX"), TU: f("TU") });
const acct = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Partial<Record<Bureau, BureauTradeline>>): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, bureaus,
});

// KASHABLE LLC (opened 10/2024): Over 120 Days Past Due; new I5 marks 07/2026 + 08/2026.
const kashable = (after: boolean) =>
  acct("KASHABLE LLC", "4417", "installment", all3((b) =>
    tl({
      dateOpened: "10/2024",
      accountType: "Installment",
      paymentStatus: "Over 120 Days Past Due",
      balance: after ? 1926 : 2572,
      pastDue: after ? (b === "TU" ? 1923 : 1926) : 1834,
      late90: after ? { EQ: 7, EX: 9, TU: 8 }[b] : { EQ: 6, EX: 7, TU: 6 }[b],
      lastPayment: after ? "09/15/2026" : "06/12/2026",
      // Address column interleaved by the reader (PR-P1-8) — must be cleaned.
      remarks: after
        ? "LAST REPORTED DELINQUENCIES: 05/2026=I5, 06/2026=I5, 07/2026=I5, 08/2026=I5 - LAST PAID: 09/2026 CAPITAL ONE BANK USA"
        : "LAST REPORTED DELINQUENCIES: 05/2026=I5, 06/2026=I5",
    }),
  ));
// TBOM MIL: 30-day lates EQ 1 / EX 1 / TU 2, dispute resolved (verified).
const tbom = (bal: number) =>
  acct("TBOM MIL", "5210", "revolving", all3((b) =>
    tl({ dateOpened: "03/2021", accountType: "Credit Card", creditLimit: 500, balance: bal, late30: b === "TU" ? 2 : 1, remarks: "DISPUTE RESOLVED REPORTED BY GRANTOR" }),
  ));
const card = (creditor: string, mask: string, limit: number, bal: number, opened: string) =>
  acct(creditor, mask, "revolving", all3(() => tl({ dateOpened: opened, accountType: "Credit Card", creditLimit: limit, balance: bal })));
const santander = (after: boolean) =>
  acct("SANTANDER CONSUMER USA", "8801", "installment", all3((b) => tl({ dateOpened: "06/2023", accountType: "Auto Loan", balance: after ? 3821 : b === "EQ" ? 5024 : 4433 })));
const maps = (after: boolean) => acct("MAPS CU", "7712", "installment", all3(() => tl({ dateOpened: "02/2022", accountType: "Installment", balance: after ? 918 : 955 })));
const closedPaid = (i: number) =>
  acct(`CLOSED LENDER ${i}`, `10${i}`, i % 2 ? "installment" : "revolving", all3(() => tl({ dateOpened: `0${(i % 9) + 1}/201${i % 9}`, accountStatus: "Closed", paymentStatus: "Paid", balance: 0 })));
// Template rows the text path published as targets / wins (must be dropped).
const junk = (toc: string) => [
  acct(toc, "", "collection", { EQ: tl({ paymentStatus: "Collection", balance: 53 }) }),
  acct("30 Days", "", "other", { EQ: tl({ paymentStatus: "Late 30 Days", late30: 1 }) }),
  acct("Included in - Bankruptcy", "", "other", { EQ: tl({ paymentStatus: "Bankruptcy" }) }),
  acct("CURRENT ACCOUNT/WAS 30 DAYS", "", "other", { EX: tl({ paymentStatus: "Late 30 Days", late30: 1 }) }),
];

const accounts = (after: boolean): CreditAccount[] => [
  kashable(after),
  tbom(after ? 480 : 450),
  card("CREDIT ONE BANK", "4431", 600, after ? 510 : 500, "08/2020"),
  card("MISSION LANE", "4772", 500, after ? 410 : 400, "11/2022"),
  card("CAPITAL ONE", "5178", 500, after ? 378 : 376, "05/2019"),
  card("MERRICK BANK", "4120", 300, 200, "01/2018"),
  santander(after),
  maps(after),
  ...Array.from({ length: 10 }, (_, i) => closedPaid(i)),
  ...junk(after ? "10. Collections 52" : "10. Collections 53"),
];
const q = (date: string, creditor: string, bureau: Bureau): CreditInquiry => ({ date, creditor, bureau, matchedAccount: null });
const file = (reportDate: string, scores: Record<Bureau, number>, after: boolean, inquiries: CreditInquiry[]): CreditFile => ({
  provider: "smartcredit", reportDate, scores, accounts: accounts(after), inquiries, publicRecordsReported: false,
  imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
});
const BEFORE = file("08/06/2026", { EQ: 507, EX: 510, TU: 611 }, false, [
  q("07/28/2026", "CREDIT TECHNOLOGY", "EQ"),
  q("07/28/2026", "CREDIT TECHNOLOGY", "EX"),
  q("07/28/2026", "FOUR CLOVER", "TU"),
]);
const AFTER = file("10/07/2026", { EQ: 496, EX: 501, TU: 606 }, true, [q("07/28/2026", "FOUR CLOVER", "TU")]);

const d = pv2Diff(BEFORE, AFTER);
const scores = { EQ: { before: 507, after: 496 }, EX: { before: 510, after: 501 }, TU: { before: 611, after: 606 } } as Record<Bureau, { before: number; after: number }>;
const pdf = pv2BuildPdfData({
  diff: d,
  clientFirstName: "Jose",
  clientName: "Jose Fernando H.",
  round: 3,
  scores,
  phone: "(949) 674-0714",
  site: "ofgllc.com",
  address: "2717 W Coast Hwy, Ste C, Newport Beach, CA 92663",
  sinceStart: { date: "08/06/2026", scores: { EQ: 507, EX: 510, TU: 611 } },
});

describe("Engine Spec v1 §8 — a client Fernando Huiza acceptance", () => {
  it("Round 1 (08/06 → 08/06): BLOCKED_DATA_INTEGRITY, not published", () => {
    expect(pv2DataIntegrity(BEFORE, BEFORE)).toMatch(/same report date/);
    // Nov 10: same content pulled on a later date = bureaus not updated yet → allowed as "No changes yet".
    expect(pv2DataIntegrity(BEFORE, { ...BEFORE, reportDate: "08/07/2026" })).toBeNull();
    expect(pv2NoChangesYet(BEFORE, { ...BEFORE, reportDate: "08/07/2026" })).toBe(true);
    // …but identical content with an unknown date is still blocked.
    expect(pv2DataIntegrity(BEFORE, { ...BEFORE, reportDate: null })).toMatch(/identical/);
    expect(pv2NoChangesYet(BEFORE, AFTER)).toBe(false);
    expect(pv2DataIntegrity(BEFORE, AFTER, { before: "abc", after: "abc" })).toMatch(/same file/);
    expect(pv2DataIntegrity(BEFORE, AFTER)).toBeNull();
  });

  it("removed (wins): exactly 1 — CREDIT TECHNOLOGY inquiry 07/28/2026, EQ + EX", () => {
    expect(d.wins).toHaveLength(1);
    expect(d.wins[0]).toMatchObject({ kind: "inquiry", status: "REMOVED" });
    expect([...d.wins[0].bureaus].sort()).toEqual(["EQ", "EX"]);
    expect(d.wins[0].item).toMatch(/CREDIT TECHNOLOGY/);
    expect(d.wins[0].item).not.toMatch(/Collections|\b53\b/);
  });

  it("still reporting: FOUR CLOVER (R1, TU) and KASHABLE (R3, EQ/EX/TU, accuracy flag e)", () => {
    const four = d.targets.find((t) => /FOUR CLOVER/.test(t.item))!;
    expect(four).toMatchObject({ round: 1, kind: "inquiry", bureaus: ["TU"] });
    const kash = d.targets.find((t) => /KASHABLE/.test(t.item))!;
    expect(kash).toMatchObject({ round: 3, kind: "account" });
    expect([...kash.bureaus].sort()).toEqual(["EQ", "EX", "TU"]);
    expect(kash.accuracy?.join(" ")).toMatch(/\(e\) past due/);
  });

  it("informational: TBOM MIL verified — remains (not a target); accuracy flag (f)", () => {
    expect(d.targets.some((t) => /TBOM/.test(t.item))).toBe(false);
    expect(d.informational.map((i) => i.item).join(" ")).toMatch(/TBOM MIL/);
    expect(d.internal.join(" | ")).toMatch(/\(f\) late counts differ by bureau.*TBOM MIL/);
  });

  it("zero checks: no positive accounts, bankruptcy, collection or TOC/template rows in output", () => {
    const text = [...d.targets.map((t) => t.item), ...d.wins.map((w) => w.item), ...d.informational.map((i) => i.item)].join(" | ");
    expect(text).not.toMatch(/Collections|30 Days|Included in|Bankruptcy|CURRENT ACCOUNT\/WAS|CREDIT ONE|MISSION LANE|SANTANDER|MAPS CU|CLOSED LENDER/);
    expect(d.targets.filter((t) => t.kind === "account").map((t) => t.item)).toEqual(["KASHABLE LLC - Late payments"]);
    expect(d.internal.join(" ")).toMatch(/Dropped template \/ table-of-contents rows/);
  });

  it("new negative development: KASHABLE I5 for 07/2026 and 08/2026", () => {
    expect(d.movementFacts.join(" ")).toMatch(/KASHABLE LLC reported new late payments \(07\/2026, 08\/2026\)/);
    expect(pv2DelinquencyMonths(AFTER.accounts[0].bureaus.EQ).map((m) => m.label)).toEqual(["05/2026", "06/2026", "07/2026", "08/2026"]);
  });

  it("revolving utilization 80% → 82%; payment progress is never a win", () => {
    expect(d.utilizationOverall).toMatchObject({ before: 80, after: 82 });
    expect(d.wins.some((w) => /SANTANDER|MAPS|KASHABLE/.test(w.item))).toBe(false);
  });

  it("change attribution: NEW_NEGATIVE_DEVELOPMENT + UTILIZATION_INCREASE on all bureaus; CONFIRMED_WIN on EQ, EX; no UNVERIFIED", () => {
    for (const b of ["EQ", "EX", "TU"] as Bureau[]) {
      expect(d.attribution[b].causes).toEqual(expect.arrayContaining(["NEW_NEGATIVE_DEVELOPMENT", "UTILIZATION_INCREASE"]));
      expect(d.attribution[b].causes).not.toContain("UNVERIFIED_MOVEMENT");
    }
    expect(d.attribution.EQ.causes).toContain("CONFIRMED_WIN");
    expect(d.attribution.EX.causes).toContain("CONFIRMED_WIN");
    expect(d.attribution.TU.causes).not.toContain("CONFIRMED_WIN");
    expect(d.attribution.EQ.delta).toBe(-11);
  });

  it("File Strength 30-45 (payment history capped by active 120+, utilization capped at 82%)", () => {
    expect(pdf.fileStrength).toBeGreaterThanOrEqual(30);
    expect(pdf.fileStrength).toBeLessThanOrEqual(45);
    expect(pdf.fileStrengthParts).toMatchObject({ paymentHistory: 10, utilization: 5 });
  });

  it("validation: no unverified movement, no hygiene / File Strength flags", () => {
    const flags = pv2Validate({
      diff: d,
      scoresBefore: { EQ: 507, EX: 510, TU: 611 },
      scoresAfter: { EQ: 496, EX: 501, TU: 606 },
      clientText: [...pdf.positives, ...pdf.wins.map((w) => w.item), ...pdf.targets.map((t) => t.item)],
      fileStrength: pdf.fileStrength,
      goal: pdf.goal,
      utilization: pdf.utilization,
    });
    expect(flags.map((f) => f.code)).not.toEqual(expect.arrayContaining(["unverified_movement"]));
    expect(flags.some((f) => f.code === "text_hygiene" || f.code === "file_strength_review" || f.code === "scores_suspicious")).toBe(false);
  });

  it("file name and 3 pages; new contact + address; only the CROA citation (v1.1 P2-2); since-start line", async () => {
    expect(progressReportFileName("Jose Fernando", "10/07/2026", 3)).toBe("Jose_OFG_Progress_Report_Oct2026_R3.pdf");
    const buf = await generateProgressReportV2Pdf({ ...pdf, sinceStart: { date: "07/01/2026", scores: { EQ: 520, EX: 515, TU: 615 } } });
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(3);
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    const text = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
    expect(text).toContain("(949) 674-0714");
    expect(text).toContain("ofgllc.com");
    expect(text).toContain("2717 W Coast Hwy, Ste C, Newport Beach, CA 92663");
    expect(text).not.toMatch(/736-5644|optimum-financial-group\.com|FCRA|FDCPA/);
    expect(text).toContain("15 U.S.C. §1679 et seq.");
    expect(text.match(/U\.S\.C/g)).toHaveLength(1);
    expect(text).toMatch(/Since you started \(07\/01\/2026\): middle score 520 -> 501 \(-19 pts\)/);
    // Cesar Oct 26: no "What Moved Your Score" in the client PDF (new negatives → targets + internal notes).
    expect(text).not.toMatch(/What Moved Your Score/);
    expect(text).not.toMatch(/10\. Collections|Included in|30 Days -/);
  }, 30_000);
});

describe("Engine Spec v1 helpers", () => {
  it("junk detector: TOC / template labels yes; real creditors (incl. digits) no", () => {
    for (const j of ["10. Collections 53", "2.1 Macys/citibank Na (CLOSED) 4", "30 Days", "120 Days Past Due", "Amount", "Included in - Bankruptcy", "CURRENT ACCOUNT/WAS 30 DAYS", "Collections 52", "Month Reviewed"]) {
      expect(pv2IsJunkItem(j), j).toBe(true);
    }
    for (const ok of ["CAPITAL ONE 360", "KASHABLE LLC", "TBOM MIL", "SYNCB/AMAZON", "LVNV FUNDING LLC"]) expect(pv2IsJunkItem(ok), ok).toBe(false);
  });

  it("remark cleaner drops the interleaved creditor / address / phone column", () => {
    expect(pv2CleanRemarks("- LAST PAID: 09/2026 CAPITAL ONE BANK USA")).toBe("- LAST PAID: 09/2026");
    expect(pv2CleanRemarks("ACCOUNT CLOSED BY GRANTOR 1680 CAPITAL ONE DR MCLEAN VA (800) 955-7070")).toBe("ACCOUNT CLOSED BY GRANTOR");
    expect(pv2CleanRemarks(null)).toBeNull();
  });

  it("accuracy flag (e) needs a recent payment; (f) needs disagreeing late counts", () => {
    const k = kashable(true);
    expect(pv2AccuracyFlags(k, new Date("2026-10-07T00:00:00Z")).join(" ")).toMatch(/\(e\)/);
    expect(pv2AccuracyFlags(k, new Date("2027-06-01T00:00:00Z")).join(" ")).not.toMatch(/\(e\)/);
    expect(pv2AccuracyFlags(tbom(450), null).join(" ")).toMatch(/\(f\).*TU 2\/0\/0/);
  });

  it("case hygiene alerts (PR-P2-3)", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(
      caseHygieneAlerts({ clientStatus: "onboarding", caseStage: "round_4", proofOfAddressPendingSince: new Date("2026-08-06T00:00:00Z"), hasRoundSchedule: false, now }).map((a) => a.code),
    ).toEqual(["status_behind_stage", "proof_of_address_pending", "no_round_schedule"]);
    expect(caseHygieneAlerts({ clientStatus: "active", caseStage: "round_4", proofOfAddressPendingSince: null, hasRoundSchedule: true, now })).toEqual([]);
  });
});

describe("Engine Spec v1 — review fixes (Oct 23 2026)", () => {
  it("real creditors whose names start with a label word are NOT junk; labels with bureau / detail suffix are", () => {
    for (const ok of ["BALANCE CREDIT", "STATUS BANK", "CREDITOR SERVICES", "AMOUNT FINANCIAL", "PAST DUE RECOVERY LLC", "CHARGE OFF RECOVERY", "REPOSSESSION SERVICES", "REPORTED CREDIT UNION"]) {
      expect(pv2IsJunkItem(ok), ok).toBe(false);
    }
    for (const j of ["Amount (EQ)", "Included in - Bankruptcy (EQ)", "30 Days - TU", "Balance:", "Account Status - Open", "120 Days Past Due (Experian)"]) {
      expect(pv2IsJunkItem(j), j).toBe(true);
    }
  });

  it("remark cleaner keeps dispute / status wording after LAST PAID (dispute holds survive)", () => {
    expect(pv2CleanRemarks("LAST PAID: 09/2026 CONSUMER DISPUTES - REINVESTIGATION IN PROGRESS")).toBe(
      "LAST PAID: 09/2026 CONSUMER DISPUTES - REINVESTIGATION IN PROGRESS",
    );
    expect(pv2CleanRemarks("LAST PAID: 09/2026 ACCOUNT CLOSED BY GRANTOR")).toBe("LAST PAID: 09/2026 ACCOUNT CLOSED BY GRANTOR");
    expect(pv2CleanRemarks("LAST PAID: 09/2026 SYNCHRONY BANK")).toBe("LAST PAID: 09/2026");
  });

  it("identical pulls whose TOC page numbers differ compare as identical (sanitized) → No changes yet", () => {
    const b = file("08/06/2026", { EQ: 507, EX: 510, TU: 611 }, false, []);
    const a = { ...b, reportDate: "08/07/2026", accounts: b.accounts.map((x) => (x.creditor === "10. Collections 53" ? { ...x, creditor: "10. Collections 52" } : x)) };
    expect(pv2DataIntegrity(b, a)).toBeNull(); // raw: page number differs
    expect(pv2DataIntegrity(pv2SanitizeFile(b).file, pv2SanitizeFile(a).file)).toBeNull();
    expect(pv2NoChangesYet(pv2SanitizeFile(b).file, pv2SanitizeFile(a).file)).toBe(true);
    const undated = { ...a, reportDate: null };
    expect(pv2DataIntegrity(pv2SanitizeFile(b).file, pv2SanitizeFile(undated).file)).toMatch(/identical/);
  });

  it("No changes yet (Nov 10): identical later pull renders the bureaus-30-days wording, 3 pages, self-check passes", async () => {
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    const later = { ...BEFORE, reportDate: "09/05/2026" };
    expect(pv2DataIntegrity(BEFORE, later)).toBeNull();
    expect(pv2NoChangesYet(BEFORE, later)).toBe(true);
    const diff0 = pv2Diff(BEFORE, later);
    expect(diff0.wins).toHaveLength(0);
    const same = { EQ: { before: 507, after: 507 }, EX: { before: 510, after: 510 }, TU: { before: 611, after: 611 } } as Record<Bureau, { before: number; after: number }>;
    for (const lang of ["en", "es"] as const) {
      const data = { ...pv2BuildPdfData({ diff: diff0, clientFirstName: "Alex", clientName: "Alex R.", round: 1, scores: same, phone: "x", site: "ofgllc.com", lang }), noChangesYet: true };
      const stats: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
      const buf = await generateProgressReportV2Pdf(data, null, stats);
      expect((await PDFDocument.load(buf)).getPageCount()).toBe(3);
      const txt = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
      if (lang === "en") {
        expect(txt).toMatch(/shows no changes yet compared to/);
        expect(txt).toMatch(/up to 30 days/);
        expect(txt).not.toMatch(/What Came Off Your Report This Round/);
      } else {
        expect(txt).toMatch(/todavia no muestra cambios/);
        expect(txt).not.toMatch(/Lo que salio de su reporte esta ronda/);
      }
      const check = pv2SelfCheck({ before: BEFORE, after: later, summaries: { before: null, after: null }, diff: diff0, pdf: data, stats, recordTargets: diff0.targets.length });
      expect(check.checks.filter((c) => c.pass === false)).toEqual([]);
      expect(check.checks.find((c) => c.key === "chronology")?.pass).toBe(true);
    }
  }, 30_000);

  it("since-start: undated (older rounds) prints without a date; redundant line (same start) is skipped", async () => {
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    const text = async (since: { date: string; scores: Record<Bureau, number | null> }) =>
      (await new PDFParse({ data: await generateProgressReportV2Pdf({ ...pdf, sinceStart: since }) }).getText()).text.replace(/\s+/g, " ");
    expect(await text({ date: "", scores: { EQ: 520, EX: 515, TU: 615 } })).toMatch(/Since you started: middle score 520 -> 501/);
    expect(await text({ date: "", scores: { EQ: 507, EX: 510, TU: 611 } })).not.toMatch(/Since you started/);
  }, 30_000);
});

