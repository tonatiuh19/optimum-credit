/**
 * Nov 2, 2026, through the real routes (synthetic data, removed afterwards):
 * - Round 1 "starting point": one report on purpose, read once, nothing compared.
 * - Review scores come from the account-level reads, for every report format.
 * - A typed score that differs from the PDF holds the report.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { OfGReportData } from "@shared/api";
import type { Bureau, CreditAccount, CreditFile } from "./creditFile";
import { createServer, createSession, reviewDataWithReadScores } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let adminId = 0;
let clientId = 0;
let caseId = 0;
const UA = "vitest-starting-point";
const B: Bureau[] = ["TU", "EX", "EQ"];
const account = (i: number, late = 0): CreditAccount => ({
  creditor: `LENDER ${i}`,
  mask: String(2000 + i),
  section: "revolving",
  headerStatus: null,
  confident: true,
  bureaus: Object.fromEntries(B.map((b) => [b, { dateOpened: "01/2015", balance: 1000 + i, creditLimit: 5000, accountStatus: "Open", paymentStatus: late ? "Late 30 Days" : "Current", pastDue: 0, late30: late, late60: 0, late90: 0, gridMarks: [] }])),
});
const file = (scores: Record<Bureau, number | null>, date = "09/14/2026", provider = "smartcredit"): CreditFile =>
  ({ provider, reportDate: date, scores, accounts: [account(1, 2), account(2), account(3)], inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 12, confidence: 1, warnings: [] }) as unknown as CreditFile;
const data = (scores: Record<"transunion" | "experian" | "equifax", { before: number; after: number }>): OfGReportData =>
  ({
    client: { firstName: "Start", lastName: "Point" },
    reportDate: { before: "2026-09-14", after: "2026-09-14" },
    bureauScores: scores,
    middleScore: { before: 0, after: 0 },
    wins: [], targets: [], utilization: [], positiveAccounts: [], actionNeeded: [],
    roadmap: { currentRound: 1, nextRound: 2, scoreGoal: 700, gapRemaining: 50, milestones: [] },
    actionPlan: [], fileStrengthScore: 40, croaDisclosure: "CROA", locale: "en",
  }) as OfGReportData;
const wrong = data({ transunion: { before: 0, after: 0 }, experian: { before: 0, after: 0 }, equifax: { before: 694, after: 694 } });

async function session(options: object, extracted: OfGReportData, reads: Array<["progress_before" | "progress_after", CreditFile]>, sha = true) {
  const [s] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, extracted_json, created_by_admin_id) VALUES (?, ?, 1, 'review', ?, ?, ?)`,
    [caseId, clientId, JSON.stringify(options), JSON.stringify(extracted), adminId],
  );
  for (const [purpose, f] of reads) {
    await pool.query(
      `INSERT INTO credit_file_extractions (client_id, report_wizard_session_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag, provider, status, extracted_json, text_skeleton_json, file_sha256)
       VALUES (?, ?, ?, 'x.pdf', 'application/pdf', 1, 'vitest://start', '00', '00', 'smartcredit', 'ready', ?, ?, ?)`,
      [clientId, s.insertId, purpose, JSON.stringify(f), JSON.stringify({ provider: "smartcredit", imagePages: 0, totalPages: 12, pullSummary2: null }), sha ? `${purpose}-${s.insertId}` : null],
    );
  }
  return s.insertId;
}
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const reads = async (id: number) => (await auth(request(app).get(`/api/admin/report-wizard/sessions/${id}/reads`))).body;
const stored = async (id: number) => {
  const [[r]] = await pool.query<RowDataPacket[]>(`SELECT extracted_json, reviewed_json, extraction_meta FROM report_wizard_sessions WHERE id = ?`, [id]);
  const p = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
  return { extracted: p(r.extracted_json), reviewed: p(r.reviewed_json), meta: p(r.extraction_meta) };
};
async function preview(id: number) {
  const res = await auth(request(app).post(`/api/admin/report-wizard/sessions/${id}/preview`)).send({}).buffer(true).parse((r, cb) => {
    const c: Buffer[] = [];
    r.on("data", (x: Buffer) => c.push(x));
    r.on("end", () => cb(null, Buffer.concat(c)));
  });
  if (res.status !== 200) return { status: res.status, body: JSON.parse((res.body as Buffer).toString() || "{}") };
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return {
    status: 200,
    selfCheck: JSON.parse(decodeURIComponent(String(res.headers["x-report-self-check"]))),
    flags: JSON.parse(decodeURIComponent(String(res.headers["x-report-review-flags"]))),
    text: (await new PDFParse({ data: res.body as Buffer }).getText()).text.replace(/\s+/g, " "),
  };
}

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [[a]] = await pool.query<RowDataPacket[]>(`SELECT id, email FROM admins WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`);
  adminId = Number(a.id);
  token = await createSession("admin", adminId, String(a.email), "127.0.0.1", UA);
  const [c] = await pool.query<ResultSetHeader>(`INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Start', 'Point', ?, 'active', 'round_1')`, [`start-point-${Date.now()}@example.test`]);
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_1', 'active')`, [clientId]);
  caseId = k.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = ?`, [UA]).catch(() => null);
  await pool.end();
});

describe("review scores come from the reads (every format)", () => {
  it.each(["smartcredit", "equifax_3b", "unknown"])("%s: wrong text-layer scores are replaced, missing bureau stays empty; only once", async (provider) => {
    const id = await session({}, wrong, [
      ["progress_before", file({ TU: 655, EX: 670, EQ: null }, "08/18/2026", provider)],
      ["progress_after", file({ TU: 694, EX: 673, EQ: null }, "09/14/2026", provider)],
    ]);
    const r = await reads(id);
    expect(r).toMatchObject({ scores_from_reads: true, read_scores: { after: { TU: 694, EX: 673, EQ: null } } });
    const s = await stored(id);
    expect(s.extracted.bureauScores).toEqual({ transunion: { before: 655, after: 694 }, experian: { before: 670, after: 673 }, equifax: { before: 0, after: 0 } });
    // A staff correction after the sync survives the next poll.
    await pool.query(`UPDATE report_wizard_sessions SET reviewed_json = ? WHERE id = ?`, [JSON.stringify({ ...s.extracted, bureauScores: { ...s.extracted.bureauScores, transunion: { before: 655, after: 700 } } }), id]);
    await reads(id);
    expect((await stored(id)).reviewed.bureauScores.transunion.after).toBe(700);
  }, 60_000);

  it("a read still running changes nothing yet", async () => {
    const id = await session({}, wrong, [["progress_after", file({ TU: 694, EX: 673, EQ: null })]]);
    await pool.query(`UPDATE credit_file_extractions SET status = 'submitted' WHERE report_wizard_session_id = ?`, [id]);
    const r = await reads(id);
    expect(r.scores_from_reads).toBe(false);
    expect((await stored(id)).extracted.bureauScores.equifax.after).toBe(694);
  }, 60_000);

  it("a read with no scores at all (image-only) keeps what the form has", () => {
    const d = data({ transunion: { before: 600, after: 610 }, experian: { before: 0, after: 0 }, equifax: { before: 0, after: 0 } });
    expect(reviewDataWithReadScores(d, { scores: { TU: null, EX: null, EQ: null } }, { scores: { TU: null, EX: null, EQ: null } })).toBeNull();
  });
});

describe("a typed score that differs from the PDF holds the report", () => {
  const before = file({ TU: 655, EX: 670, EQ: null }, "08/18/2026");
  const after = file({ TU: 694, EX: 673, EQ: null }, "09/14/2026");
  it.each([
    ["all match", { transunion: { before: 655, after: 694 }, experian: { before: 670, after: 673 }, equifax: { before: 0, after: 0 } }, true, null],
    ["wrong Before (Dorrian)", { transunion: { before: 667, after: 694 }, experian: { before: 654, after: 673 }, equifax: { before: 0, after: 0 } }, false, /TU Before: report 667, PDF 655/],
    ["score typed for a bureau with none", { transunion: { before: 655, after: 694 }, experian: { before: 670, after: 673 }, equifax: { before: 0, after: 688 } }, false, /EQ After: report 688, PDF no score/],
    ["real score left out", { transunion: { before: 655, after: 0 }, experian: { before: 670, after: 673 }, equifax: { before: 0, after: 0 } }, false, /TU After: report no score, PDF 694/],
  ])("%s", async (_n, scores, pass, re) => {
    const id = await session({}, data(scores as any), [["progress_before", before], ["progress_after", after]]);
    const p = await preview(id);
    expect(p.status).toBe(200);
    const c = p.selfCheck.checks.find((x: any) => x.key === "scores");
    expect(c.pass).toBe(pass);
    if (re) expect(c.detail).toMatch(re);
  }, 60_000);
});

describe("Round 1 starting point", () => {
  const one = file({ TU: 694, EX: 673, EQ: null });
  const sp = data({ transunion: { before: 694, after: 694 }, experian: { before: 673, after: 673 }, equifax: { before: 0, after: 0 } });

  it("one read serves both sides; ready, no data-integrity block, no second read", async () => {
    const id = await session({ starting_point: true }, sp, [["progress_after", one]]);
    const r = await reads(id);
    expect(r).toMatchObject({ ready: true, starting_point: true, blocked_data_integrity: null, score_update_available: false });
    expect(r.reads.before.status).toBe("ready");
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT purpose FROM credit_file_extractions WHERE report_wizard_session_id = ?`, [id]);
    expect(rows.map((x) => x.purpose)).toEqual(["progress_after"]);
  }, 60_000);

  it("preview: starting-point wording, items to dispute, nothing removed, self-check passes", async () => {
    const id = await session({ starting_point: true }, sp, [["progress_after", one]]);
    const p = await preview(id);
    expect(p.status).toBe(200);
    expect(p.text).toMatch(/this is your starting point as of 09\/14\/2026/);
    expect(p.text).toMatch(/LENDER 1/);
    expect(p.text).not.toMatch(/What Came Off Your Report/);
    expect(p.flags.map((f: any) => f.code)).not.toContain("same_pull");
    expect(p.selfCheck.checks.filter((c: any) => c.pass === false)).toEqual([]);
  }, 60_000);

  it("the same two reads WITHOUT the option stay blocked", async () => {
    const id = await session({}, sp, [["progress_before", one], ["progress_after", one]]);
    expect((await reads(id)).blocked_data_integrity).toMatch(/same report date/);
  }, 60_000);

  const pdf = async (text: string) => {
    const d = await PDFDocument.create();
    d.addPage([300, 300]).drawText(text, { x: 20, y: 150, size: 12, font: await d.embedFont(StandardFonts.Helvetica) });
    return Buffer.from(await d.save());
  };
  const create = (round: string, fields: Record<string, string>, files: Record<string, Buffer>) => {
    let r = auth(request(app).post(`/api/admin/cases/${caseId}/report-wizard/sessions`)).field("round_number", round).field("enhance_with_claude", "false");
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const [k, v] of Object.entries(files)) r = r.attach(k, v, { filename: `${k}.pdf`, contentType: "application/pdf" });
    return r;
  };

  it.each([
    ["not Round 1", "2", { starting_point: "true" }, false, "starting_point_round_1_only"],
    ["with a Before file too", "1", { starting_point: "true" }, true, "starting_point_one_file"],
    ["combined with Score update", "1", { starting_point: "true", score_update: "true" }, false, "starting_point_score_update"],
  ])("refused: %s", async (_n, round, fields, withBefore, code) => {
    const a = await pdf("Report");
    const res = await create(round, fields as any, withBefore ? { before_pdf: await pdf("Other"), after_pdf: a } : { after_pdf: a });
    expect(res.body.code).toBe(code);
  }, 60_000);

  it("the same file twice without the option is still refused", async () => {
    const a = await pdf("Report");
    const res = await create("1", {}, { before_pdf: a, after_pdf: Buffer.from(a) });
    expect(res.body.code).toBe("same_file");
  }, 60_000);
});
