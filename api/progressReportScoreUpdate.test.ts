/**
 * Score update engine (Oct 28, 2026): inquiry verification is all-or-nothing
 * against the totals each report prints, so a half-loaded read can never turn
 * into a "removed" win; the self-check, PDF, stored data and client email carry
 * no account results.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { OfGReportData } from "@shared/api";
import type { Bureau, CreditFile, CreditInquiry } from "./creditFile";
import {
  PV2_SUMMARY_PARSER_VERSION,
  generateScoreUpdatePdf,
  pv2ScoreUpdateInquiries,
  pv2ScoreUpdateSelfCheck,
  type Pv2PullSummary,
  type Pv2ScoreUpdateInquiries,
} from "./progressReportV2";
import { scoreUpdateReportData, tplRoundComplete } from "./index";

const B: Bureau[] = ["TU", "EX", "EQ"];
const inq = (creditor: string, date: string, bureau: Bureau | null): CreditInquiry => ({ creditor, date, bureau, matchedAccount: null });
const file = (reportDate: string | null, inquiries: CreditInquiry[]): CreditFile =>
  ({ provider: "smartcredit", reportDate, scores: { TU: null, EX: null, EQ: null }, accounts: [], inquiries, publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [] }) as unknown as CreditFile;
const summary = (printed: Partial<Record<Bureau, number | null>>): Pv2PullSummary =>
  ({
    parserVersion: PV2_SUMMARY_PARSER_VERSION,
    format: "smartcredit",
    reportDate: null,
    perBureau: Object.fromEntries(B.map((b) => [b, { totalAccounts: 10, openAccounts: 3, closedAccounts: 7, balances: 1000, publicRecords: 0, inquiries2y: printed[b] ?? null }])),
    revolving: { TU: null, EX: null, EQ: null },
  }) as Pv2PullSummary;

const CAP = [inq("CAPITAL ONE", "03/01/2026", "TU"), inq("CAPITAL ONE", "03/01/2026", "EX")];
const DISC = inq("DISCOVER", "04/10/2026", "EQ");
const before = () => file("06/19/2026", [...CAP, DISC]);
const SB = () => summary({ TU: 1, EX: 1, EQ: 1 });

describe("pv2ScoreUpdateInquiries", () => {
  it("both reads match the printed totals → verified, removed inquiry itemized (one row, both bureaus)", () => {
    const r = pv2ScoreUpdateInquiries({ before: before(), after: file("10/22/2026", [DISC]), summaryBefore: SB(), summaryAfter: summary({ TU: 0, EX: 0, EQ: 1 }) });
    expect(r.verified).toBe(true);
    expect(r.counts).toEqual({ TU: { before: 1, after: 0 }, EX: { before: 1, after: 0 }, EQ: { before: 1, after: 1 } });
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatchObject({ kind: "inquiry", status: "REMOVED" });
    expect(r.removed[0].item).toMatch(/CAPITAL ONE/);
    expect([...r.removed[0].bureaus].sort()).toEqual(["EX", "TU"]);
  });

  it.each<[string, Partial<Parameters<typeof pv2ScoreUpdateInquiries>[0]>, RegExp]>([
    // The core safety case: the half-loaded After misses an inquiry the report itself prints.
    ["After read misses a printed inquiry", { after: file("10/22/2026", [DISC]), summaryAfter: summary({ TU: 1, EX: 0, EQ: 1 }) }, /After TU: read 0 of 1/],
    ["Before read misses a printed inquiry", { before: file("06/19/2026", [CAP[0], DISC]) }, /Before EX: read 0 of 1/],
    ["a bureau prints no total", { summaryAfter: summary({ TU: 0, EX: 0 }) }, /do not print inquiry totals/],
    ["no summary on one side", { summaryBefore: null }, /do not print inquiry totals/],
    ["an inquiry with no bureau", { after: file("10/22/2026", [DISC, inq("ACME", "05/01/2026", null)]) }, /does not say which bureau/],
    ["an undated inquiry", { after: file("10/22/2026", [{ ...DISC, date: "" }]) }, /undated inquiry or no report date/],
    ["no report date", { after: file(null, [DISC]) }, /undated inquiry or no report date/],
    ["a read is missing", { after: null }, /a read is missing/],
  ])("not verified when %s → totals only, nothing itemized", (_n, override, reason) => {
    const r = pv2ScoreUpdateInquiries({ before: before(), after: file("10/22/2026", [DISC]), summaryBefore: SB(), summaryAfter: summary({ TU: 0, EX: 0, EQ: 1 }), ...override });
    expect(r.verified).toBe(false);
    expect(r.removed).toEqual([]);
    expect(r.reason).toMatch(reason);
  });

  it("an inquiry older than 2 years is outside the printed window (not counted, aged off — never a win)", () => {
    const old = inq("OLD BANK", "01/15/2024", "TU");
    const r = pv2ScoreUpdateInquiries({
      before: file("06/19/2026", [...CAP, DISC, old]),
      after: file("10/22/2026", [...CAP, DISC]),
      summaryBefore: SB(),
      summaryAfter: summary({ TU: 1, EX: 1, EQ: 1 }),
    });
    expect(r.verified).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it("the same company spelled differently is one inquiry (engine canonical names) → no false removal", () => {
    const r = pv2ScoreUpdateInquiries({
      before: file("06/19/2026", [inq("KCB CREDIT", "03/01/2026", "TU")]),
      after: file("10/22/2026", [inq("KCBCREDIT", "03/01/2026", "TU")]),
      summaryBefore: summary({ TU: 1, EX: 0, EQ: 0 }),
      summaryAfter: summary({ TU: 1, EX: 0, EQ: 0 }),
    });
    expect(r.verified).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it("counts are the printed totals even when not verified", () => {
    const r = pv2ScoreUpdateInquiries({ before: null, after: null, summaryBefore: SB(), summaryAfter: summary({ TU: 3, EX: 2, EQ: 1 }) });
    expect(r.counts.TU).toEqual({ before: 1, after: 3 });
    expect(r.verified).toBe(false);
  });
});

const INQ_NONE: Pv2ScoreUpdateInquiries = { counts: { TU: { before: null, after: null }, EX: { before: null, after: null }, EQ: { before: null, after: null } }, removed: [], verified: false, reason: "x" };
const SCORES = { TU: { before: 601, after: 634 }, EX: { before: 588, after: 612 }, EQ: { before: 640, after: 655 } };

describe("pv2ScoreUpdateSelfCheck", () => {
  it.each([
    { name: "scores on both reports, dates in order → pass", scores: SCORES, b: "06/19/2026", a: "10/22/2026", pass: true },
    { name: "one bureau on both reports is enough", scores: { ...SCORES, EX: { before: null, after: 612 }, EQ: { before: 640, after: null } }, b: "06/19/2026", a: "10/22/2026", pass: true },
    { name: "no bureau on both reports → fail", scores: { TU: { before: null, after: 634 }, EX: { before: 588, after: null }, EQ: { before: null, after: null } }, b: "06/19/2026", a: "10/22/2026", pass: false },
    { name: "Before newer than After → fail", scores: SCORES, b: "10/22/2026", a: "06/19/2026", pass: false },
    { name: "dates not printed → not applicable, still pass", scores: SCORES, b: null, a: null, pass: true },
  ])("$name", ({ scores, b, a, pass }) => {
    expect(pv2ScoreUpdateSelfCheck({ scores: scores as any, beforeDate: b, afterDate: a, inquiries: INQ_NONE }).pass).toBe(pass);
  });
});

describe("generateScoreUpdatePdf", () => {
  const text = async (buf: Buffer) => {
    await import("pdf-parse/worker").catch(() => undefined);
    const { PDFParse } = await import("pdf-parse");
    return (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");
  };
  const base = {
    clientName: "Ana Lopez",
    clientFirstName: "Ana",
    round: 5,
    baselineDate: "06/19/2026",
    currentDate: "10/22/2026",
    scores: SCORES,
    phone: "(555) 000-0000",
    site: "example.test",
  };
  it.each(["en", "es"] as const)("%s: one page, scores + middle score, no inquiry list when unverified", async (lang) => {
    const buf = await generateScoreUpdatePdf({ ...base, lang, inquiries: INQ_NONE });
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(1);
    const t = await text(buf);
    expect(t).toMatch(lang === "es" ? /ACTUALIZACION DE PUNTAJE/ : /CREDIT SCORE UPDATE/);
    expect(t).toMatch(/601 634 \+33/);
    expect(t).toMatch(lang === "es" ? /proximo informe completo/ : /next full report/);
    expect(t).not.toMatch(/Inquiries Removed|Consultas eliminadas/);
  });
  it("a long removed-inquiry list stays on one page", async () => {
    const removed = Array.from({ length: 40 }, (_, i) => ({ item: `LENDER ${i} - Hard inquiry 01/0${(i % 9) + 1}/2026`, bureaus: ["TU"] as Bureau[], impact: "LOW" as const, status: "REMOVED" as const, remainsOn: [], kind: "inquiry" as const }));
    const buf = await generateScoreUpdatePdf({ ...base, lang: "en", inquiries: { ...INQ_NONE, verified: true, removed, counts: { TU: { before: 40, after: 0 }, EX: { before: 0, after: 0 }, EQ: { before: 0, after: 0 } } } });
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(1);
  });
});

describe("stored data + client email", () => {
  const DATA = {
    client: { firstName: "Ana" },
    reportDate: { before: "2026-06-19", after: "2026-10-22" },
    bureauScores: { transunion: { before: 601, after: 634 }, experian: { before: 588, after: 612 }, equifax: { before: 640, after: 655 } },
    middleScore: { before: 601, after: 634 },
    wins: [{ itemRemoved: "TEXT WIN", bureaus: ["TU"], impact: "high", status: "Removed" }],
    targets: [{ item: "TEXT TARGET", bureaus: ["TU"], detail: "x", priority: "high" }],
    utilization: [{ account: "X", limit: 1, balance: 1, pctUsed: 100, payTo30: 1, payTo10: 1 }],
    positiveAccounts: ["P"],
    actionNeeded: ["A"],
    roadmap: { currentRound: 5, nextRound: 6, scoreGoal: 700, gapRemaining: 66, milestones: [] },
    actionPlan: [{ step: 1, description: "x", owner: "client" }],
    fileStrengthScore: 40,
    croaDisclosure: "CROA",
  } as OfGReportData;

  it("only verified inquiry wins are stored; every account field is emptied", () => {
    const removed = [{ item: "CAPITAL ONE - Hard inquiry 03/01/2026", bureaus: ["TU", "EX"] as Bureau[], impact: "LOW" as const, status: "REMOVED" as const, remainsOn: [], kind: "inquiry" as const }];
    const d = scoreUpdateReportData(DATA, { inquiries: { ...INQ_NONE, verified: true, removed } });
    expect(d.wins).toEqual([{ itemRemoved: removed[0].item, bureaus: ["TU", "EX"], impact: "low", status: "Removed" }]);
    expect(d.winsThisRound).toEqual(d.wins);
    expect(d.targets).toEqual([]);
    expect(d.utilization).toEqual([]);
    expect(d.positiveAccounts).toEqual([]);
    expect(d.actionNeeded).toEqual([]);
    expect(d.actionPlan).toEqual([]);
    expect(d.bureauScores).toEqual(DATA.bureauScores);
    expect(scoreUpdateReportData(DATA, { inquiries: INQ_NONE }).wins).toEqual([]);
  });

  it.each(["en", "es"])("%s email: score change, no 'items removed' tile, next-report promise", (lang) => {
    const t = tplRoundComplete({ firstName: "Ana", roundNumber: 5, scoreBefore: 601, scoreAfter: 634, itemsRemoved: 0, portalUrl: "https://x/portal", securePdfUrl: "https://x/pdf", lang, scoreUpdate: true });
    expect(t.html).toMatch(/\+33/);
    expect(t.html).not.toMatch(/Items Removed|Elementos eliminados/);
    expect(t.subject).toMatch(lang === "es" ? /actualización de puntaje/ : /score update/);
    expect(t.html).toMatch(lang === "es" ? /próximo informe/ : /next progress report/);
  });

  it("a full report email is unchanged", () => {
    const t = tplRoundComplete({ firstName: "Ana", roundNumber: 5, scoreBefore: 601, scoreAfter: 634, itemsRemoved: 3, portalUrl: "https://x/portal", lang: "en" });
    expect(t.html).toMatch(/Items Removed/);
    expect(t.subject).toMatch(/progress report is ready/);
  });
});
