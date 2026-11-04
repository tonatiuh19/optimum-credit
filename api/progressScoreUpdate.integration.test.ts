/**
 * Score update (Oct 28, 2026) — end to end through the real routes, one synthetic
 * wizard session per scenario (no real client data; everything is created and
 * removed by this file). An incomplete SmartCredit print can be sent as a short
 * Score update: staff-verified scores, the inquiry totals each report prints, and
 * removed inquiries only when both reads are proven complete. Never any account
 * result, never an automatic switch, never reused as a later round's Before.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { OfGReportData } from "@shared/api";
import type { Bureau, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import { createServer, createSession } from "./index";
import { PV2_SUMMARY_PARSER_VERSION } from "./progressReportV2";
import { createIntegrationTestPool } from "./testDbCleanup";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let adminId = 0;
let clientId = 0;
let caseId = 0;
const UA = "vitest-score-update";

const B: Bureau[] = ["TU", "EX", "EQ"];
const account = (i: number, balance: number): CreditAccount => ({
  creditor: `LENDER ${i}`,
  mask: String(2000 + i),
  section: "revolving",
  headerStatus: null,
  confident: true,
  bureaus: Object.fromEntries(B.map((b) => [b, { dateOpened: "01/2015", balance, creditLimit: 5000, accountStatus: "Open", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [] }])),
});
const inq = (creditor: string, date: string, bureau: Bureau | null): CreditInquiry => ({ creditor, date, bureau, matchedAccount: null });
// Same scores as the review (DATA): a typed score that differs from the PDF holds the report.
const read = (n: number, balance: number, reportDate: string, inquiries: CreditInquiry[] = []): CreditFile =>
  ({ provider: "smartcredit", reportDate, scores: reportDate.startsWith("06") ? { TU: 601, EX: 588, EQ: 640 } : { TU: 634, EX: 612, EQ: 655 }, accounts: Array.from({ length: n }, (_, i) => account(i, balance)), inquiries, publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [] }) as unknown as CreditFile;
/** SmartCredit summary as cached on the read (text_skeleton_json.pullSummary2). */
const summary = (total: number, balances: number, reportDate: string, inquiries2y: Record<Bureau, number | null>) => ({
  parserVersion: PV2_SUMMARY_PARSER_VERSION,
  format: "smartcredit",
  reportDate,
  perBureau: Object.fromEntries(B.map((b) => [b, { totalAccounts: total, openAccounts: 3, closedAccounts: total - 3, balances, publicRecords: 0, inquiries2y: inquiries2y[b] }])),
  revolving: { TU: null, EX: null, EQ: null },
});

type Side = { status?: "ready" | "failed" | "submitted"; file?: CreditFile; skeleton?: Record<string, unknown>; error?: string; sha?: string };

// Before (complete): Capital One on TU + EX, Discover on EQ — the summary prints 1 / 1 / 1.
const BEFORE_INQ = [inq("CAPITAL ONE", "03/01/2026", "TU"), inq("CAPITAL ONE", "03/01/2026", "EX"), inq("DISCOVER", "04/10/2026", "EQ")];
const completeBefore = (): Side => ({
  file: read(12, 4000, "06/19/2026", BEFORE_INQ),
  skeleton: { provider: "smartcredit", imagePages: 0, totalPages: 20, pullSummary2: summary(12, 48000, "06/19/2026", { TU: 1, EX: 1, EQ: 1 }) },
});
const completeAfter = (): Side => ({
  file: read(12, 3500, "10/22/2026", [BEFORE_INQ[2]]),
  skeleton: { provider: "smartcredit", imagePages: 0, totalPages: 20, pullSummary2: summary(12, 42000, "10/22/2026", { TU: 0, EX: 0, EQ: 1 }) },
});
/** After saved before the account pages loaded (2 of 12 accounts); its summary still prints the totals. */
const incompleteAfter = (printed: Record<Bureau, number | null> = { TU: 0, EX: 0, EQ: 1 }, inquiries: CreditInquiry[] = [BEFORE_INQ[2]]): Side => ({
  file: read(2, 3500, "10/22/2026", inquiries),
  skeleton: { provider: "smartcredit", imagePages: 12, totalPages: 18, pullSummary2: summary(12, 42000, "10/22/2026", printed) },
});

const DATA: OfGReportData = {
  client: { firstName: "Score", lastName: "Update" },
  reportDate: { before: "2026-06-19", after: "2026-10-22" },
  bureauScores: {
    transunion: { before: 601, after: 634 },
    experian: { before: 588, after: 612 },
    equifax: { before: 640, after: 655 },
  },
  middleScore: { before: 601, after: 634 },
  wins: [{ itemRemoved: "TEXT-LAYER WIN", bureaus: ["TU"], impact: "high", status: "Removed" }],
  targets: [{ item: "TEXT-LAYER TARGET", bureaus: ["TU"], detail: "x", priority: "high" }],
  utilization: [],
  positiveAccounts: [],
  actionNeeded: [],
  roadmap: { currentRound: 1, nextRound: 2, scoreGoal: 700, gapRemaining: 66, milestones: [] },
  actionPlan: [],
  fileStrengthScore: 40,
  croaDisclosure: "Results vary. CROA disclosure.",
  locale: "en",
};

async function scenario(before: Side, after: Side, opts: { scoreUpdate?: boolean; round?: number } = {}) {
  const [s] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, extracted_json, created_by_admin_id)
     VALUES (?, ?, ?, 'review', ?, ?, ?)`,
    [caseId, clientId, opts.round ?? 1, JSON.stringify(opts.scoreUpdate ? { score_update: true } : {}), JSON.stringify(DATA), adminId],
  );
  for (const [purpose, side] of [["progress_before", before], ["progress_after", after]] as const) {
    await pool.query(
      `INSERT INTO credit_file_extractions (client_id, report_wizard_session_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag,
         provider, status, extracted_json, text_skeleton_json, error_message, file_sha256)
       VALUES (?, ?, ?, 'x.pdf', 'application/pdf', 1, 'vitest://score-update', '00', '00', 'smartcredit', ?, ?, ?, ?, ?)`,
      [
        clientId,
        s.insertId,
        purpose,
        side.status ?? "ready",
        side.file ? JSON.stringify(side.file) : null,
        JSON.stringify(side.skeleton ?? { provider: "smartcredit", imagePages: 0, totalPages: 12, pullSummary2: null }),
        side.error ?? null,
        side.sha ?? `${purpose}-${s.insertId}`,
      ],
    );
  }
  return s.insertId;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const reads = async (id: number) => {
  const r = await auth(request(app).get(`/api/admin/report-wizard/sessions/${id}/reads`));
  expect(r.status).toBe(200);
  return r.body;
};
const toggle = (id: number, enabled: boolean) => auth(request(app).post(`/api/admin/report-wizard/sessions/${id}/score-update`)).send({ enabled });
async function preview(id: number) {
  const res = await auth(request(app).post(`/api/admin/report-wizard/sessions/${id}/preview`))
    .send({})
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) return { status: res.status, body: JSON.parse((res.body as Buffer).toString("utf8") || "{}") };
  const buf = res.body as Buffer;
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return {
    status: 200,
    kind: String(res.headers["x-report-kind"] || ""),
    selfCheck: JSON.parse(decodeURIComponent(String(res.headers["x-report-self-check"] || "%7B%7D"))),
    pages: (await PDFDocument.load(buf)).getPageCount(),
    text: (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " "),
  };
}

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [[a]] = await pool.query<RowDataPacket[]>(`SELECT id, email FROM admins WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`);
  adminId = Number(a.id);
  token = await createSession("admin", adminId, String(a.email), "127.0.0.1", UA);
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Score', 'Update', ?, 'active', 'round_1')`,
    [`score-update-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_1', 'active')`, [clientId]);
  caseId = k.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'report_wizard.score_update' AND entity_type = 'report_wizard_session' AND entity_id IN (SELECT id FROM report_wizard_sessions WHERE client_id = ?)`, [clientId]).catch(() => null);
  await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = ?`, [UA]).catch(() => null);
  await pool.end();
});

describe("reads: when a Score update is offered", () => {
  it.each([
    { name: "After incomplete, Before complete → offered", before: completeBefore(), after: incompleteAfter(), available: true, sides: ["after"] },
    { name: "both complete → not offered (full report)", before: completeBefore(), after: completeAfter(), available: false, sides: [] },
    { name: "After still reading → not offered yet", before: completeBefore(), after: { status: "submitted" as const }, available: false, sides: [] },
    {
      name: "Before incomplete + After failed for another reason → not offered",
      before: { file: read(2, 4000, "06/19/2026"), skeleton: { provider: "smartcredit", imagePages: 12, totalPages: 18, pullSummary2: null } },
      after: { status: "failed" as const, error: "Claude error: overloaded" },
      available: false,
      sides: ["before"],
    },
  ])("$name", async ({ before, after, available, sides }) => {
    const id = await scenario(before, after);
    const body = await reads(id);
    expect(body.score_update).toBe(false);
    expect(body.score_update_available).toBe(available);
    expect(body.incomplete_sides).toEqual(sides);
  }, 60_000);
});

describe("switching a draft in and out of Score update", () => {
  it("refused when nothing is incomplete; allowed when a read is; reversible; audited", async () => {
    const full = await scenario(completeBefore(), completeAfter());
    const no = await toggle(full, true);
    expect(no.status).toBe(422);
    expect(no.body.code).toBe("score_update_not_needed");

    const id = await scenario(completeBefore(), incompleteAfter());
    expect((await reads(id)).ready).toBe(false);
    const on = await toggle(id, true);
    expect(on.status).toBe(200);
    expect(on.body.session.options_json.score_update).toBe(true);
    const r1 = await reads(id);
    expect(r1).toMatchObject({ score_update: true, ready: true });

    const off = await toggle(id, false);
    expect(off.status).toBe(200);
    expect(off.body.session.options_json.score_update).toBeUndefined();
    expect(await reads(id)).toMatchObject({ score_update: false, ready: false });

    const [audit] = await pool.query<RowDataPacket[]>(
      `SELECT changes_json FROM audit_logs WHERE action = 'report_wizard.score_update' AND entity_id = ? ORDER BY id`,
      [id],
    );
    expect(audit.map((a) => (typeof a.changes_json === "string" ? JSON.parse(a.changes_json) : a.changes_json).enabled)).toEqual([true, false]);
  }, 60_000);

  it("a published session never changes", async () => {
    const id = await scenario(completeBefore(), incompleteAfter());
    await pool.query(`UPDATE report_wizard_sessions SET status = 'published' WHERE id = ?`, [id]);
    try {
      const res = await toggle(id, true);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("session_published");
    } finally {
      // Never leave a published Round 1 behind (it would block the publish / upload scenarios).
      await pool.query(`DELETE FROM credit_file_extractions WHERE report_wizard_session_id = ?`, [id]);
      await pool.query(`DELETE FROM report_wizard_sessions WHERE id = ?`, [id]);
    }
  }, 60_000);
});

describe("Score update preview", () => {
  it("verified inquiries: scores from review, printed totals, removed inquiry itemized — no account results", async () => {
    const id = await scenario(completeBefore(), incompleteAfter(), { scoreUpdate: true });
    const p = await preview(id);
    expect(p.status).toBe(200);
    expect(p.kind).toBe("score_update");
    expect(p.pages).toBe(1);
    expect(p.text).toMatch(/CREDIT SCORE UPDATE/);
        expect(p.text).toMatch(/TransUnion 601 634 \+33/);
    expect(p.text).toMatch(/Middle score 601 634 \+33 pts/);
    expect(p.text).toMatch(/Hard Inquiries \(last 2 years\)/);
    expect(p.text).toMatch(/Inquiries Removed.*CAPITAL ONE/);
    expect(p.text).not.toMatch(/DISCOVER.*Removed/);
    // Never an account, and never the text-layer wins / targets.
    expect(p.text).not.toMatch(/LENDER|TEXT-LAYER/);
    expect(p.text).toMatch(/full account-by-account review/);
    expect(p.selfCheck.pass).toBe(true);
    expect(p.selfCheck.checks.find((c: any) => c.key === "inquiries")).toMatchObject({ pass: true });
  }, 60_000);

  it("unverified inquiries (After read misses one the report prints) → totals only, nothing itemized", async () => {
    // The After summary prints 1 TransUnion inquiry; the half-loaded read has none → not complete.
    const id = await scenario(completeBefore(), incompleteAfter({ TU: 1, EX: 0, EQ: 1 }), { scoreUpdate: true });
    const p = await preview(id);
    expect(p.status).toBe(200);
    expect(p.text).not.toMatch(/Inquiries Removed|CAPITAL ONE/);
    expect(p.text).toMatch(/Totals as printed on your credit reports/);
    expect(p.selfCheck.pass).toBe(true);
    expect(p.selfCheck.checks.find((c: any) => c.key === "inquiries")).toMatchObject({ pass: null });
  }, 60_000);

  it("Spanish: Spanish labels, same safety", async () => {
    const id = await scenario(completeBefore(), incompleteAfter(), { scoreUpdate: true });
    await pool.query(`UPDATE report_wizard_sessions SET extracted_json = ? WHERE id = ?`, [JSON.stringify({ ...DATA, locale: "es" }), id]);
    const p = await preview(id);
    expect(p.status).toBe(200);
    expect(p.text).toMatch(/ACTUALIZACION DE PUNTAJE/);
    expect(p.text).toMatch(/Consultas eliminadas.*CAPITAL ONE/);
    expect(p.text).not.toMatch(/LENDER/);
  }, 60_000);

  it.each([
    { name: "both reads complete → full report required (422)", before: completeBefore(), after: completeAfter(), status: 422, code: "score_update_not_needed" },
    { name: "a read still running → wait (409)", before: completeBefore(), after: { status: "submitted" as const }, status: 409, code: "reads_pending" },
    {
      name: "the other read failed for another reason → needs review (422)",
      before: completeBefore(),
      after: { status: "failed" as const, error: "Claude error: overloaded" },
      status: 422,
      code: "reads_failed",
    },
    { name: "same file both sides → blocked (422)", before: { ...completeBefore(), sha: "dup-sha" }, after: { ...incompleteAfter(), sha: "dup-sha" }, status: 422, code: "blocked_data_integrity" },
  ])("gate: $name", async ({ before, after, status, code }) => {
    const id = await scenario(before, after, { scoreUpdate: true });
    const p = await preview(id);
    expect(p.status).toBe(status);
    expect(p.body.code).toBe(code);
  }, 60_000);

  it("publish runs the same gate (both complete → 422, nothing published)", async () => {
    const id = await scenario(completeBefore(), completeAfter(), { scoreUpdate: true });
    const res = await auth(request(app).post(`/api/admin/report-wizard/sessions/${id}/finalize`)).send({ compliance_acknowledged: true, acknowledge_score_anomalies: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("score_update_not_needed");
    const [[s]] = await pool.query<RowDataPacket[]>(`SELECT status FROM report_wizard_sessions WHERE id = ?`, [id]);
    expect(s.status).toBe("review");
    const [rr] = await pool.query<RowDataPacket[]>(`SELECT id FROM client_round_reports WHERE wizard_session_id = ?`, [id]);
    expect(rr).toHaveLength(0);
  }, 60_000);
});

describe("upload: Score update is opt-in and only for an incomplete print", () => {
  const pdf = async (text: string) => {
    const d = await PDFDocument.create();
    d.addPage([300, 300]).drawText(text, { x: 20, y: 150, size: 12, font: await d.embedFont(StandardFonts.Helvetica) });
    return Buffer.from(await d.save());
  };
  const create = async (before: Buffer, after: Buffer, scoreUpdate: boolean) => {
    const r = auth(request(app).post(`/api/admin/cases/${caseId}/report-wizard/sessions`))
      .field("round_number", "1")
      .field("enhance_with_claude", "false")
      .attach("before_pdf", before, { filename: "b.pdf", contentType: "application/pdf" })
      .attach("after_pdf", after, { filename: "a.pdf", contentType: "application/pdf" });
    return scoreUpdate ? r.field("score_update", "true") : r;
  };

  it("complete PDFs + Score update requested → 422 score_update_not_needed (no session)", async () => {
    const [[before]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
    const res = await create(await pdf("Report one"), await pdf("Report two"), true);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("score_update_not_needed");
    const [[after]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
    expect(after.n).toBe(before.n);
  }, 60_000);

  it("the same file twice is refused even with Score update, and not offered one", async () => {
    const a = await pdf("Report one");
    const res = await create(a, Buffer.from(a), true);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("same_file");
    expect(res.body.score_update_available).toBe(false);
  }, 60_000);
});

describe("next round never reuses an incomplete PDF from a Score update", () => {
  it.each([
    { mode: "baseline", sides: ["before"], blocked: true },
    { mode: "baseline", sides: ["after"], blocked: false },
    { mode: "chain", sides: ["after"], blocked: true },
    { mode: "chain", sides: ["before"], blocked: false },
  ])("$mode mode, incomplete $sides → reuse blocked: $blocked", async ({ mode, sides, blocked }) => {
    await pool.query(`UPDATE credit_repair_cases SET report_compare_mode = ? WHERE id = ?`, [mode, caseId]);
    await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
    await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ? AND status = 'published'`, [clientId]);
    const [s] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, created_by_admin_id, published_at)
       VALUES (?, ?, 1, 'published', '{"score_update":true}', ?, NOW())`,
      [caseId, clientId, adminId],
    );
    try {
      // Source PDF rows so before_pdf_id / after_pdf_id are real.
      const src = async (role: "before" | "after") =>
        (
          await pool.query<ResultSetHeader>(
            `INSERT INTO round_report_source_pdfs (session_id, role, file_name, storage_key, enc_iv, enc_tag, uploaded_by_admin_id)
             VALUES (?, ?, 'r1.pdf', 'vitest://score-update', REPEAT('0',32), REPEAT('0',32), ?)`,
            [s.insertId, role, adminId],
          )
        )[0].insertId;
      await pool.query(`UPDATE report_wizard_sessions SET before_pdf_id = ?, after_pdf_id = ? WHERE id = ?`, [await src("before"), await src("after"), s.insertId]);
      await pool.query(
        `INSERT INTO client_round_reports (client_id, case_id, round_number, wizard_session_id, engine_json) VALUES (?, ?, 1, ?, ?)`,
        [clientId, caseId, s.insertId, JSON.stringify({ engine: "score_update", incomplete_sides: sides })],
      );
      const ctx = await auth(request(app).get(`/api/admin/cases/${caseId}/report-wizard/before-context`).query({ round_number: 2 }));
      expect(ctx.status).toBe(200);
      expect(ctx.body.context.can_reuse).toBe(!blocked);
      expect(ctx.body.context.reuse_blocked).toBe(blocked ? "incomplete_source" : undefined);
    } finally {
      await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
      await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ? AND status = 'published'`, [clientId]);
      await pool.query(`UPDATE credit_repair_cases SET report_compare_mode = 'baseline' WHERE id = ?`, [caseId]);
    }
  }, 60_000);
});

describe("baseline: an enrollment Before proven incomplete in a later round is never reused", () => {
  it.each([
    { name: "Round 3 reused the enrollment Before and it was incomplete → blocked", beforeSource: "enrollment", blocked: true },
    { name: "Round 3 used its own uploaded Before (incomplete) → enrollment still reusable", beforeSource: "upload", blocked: false },
  ])("$name", async ({ beforeSource, blocked }) => {
    await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
    await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ? AND status = 'published'`, [clientId]);
    const session = async (round: number, opts: string, source: string) =>
      (
        await pool.query<ResultSetHeader>(
          `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, before_source, created_by_admin_id, published_at)
           VALUES (?, ?, ?, 'published', ?, ?, ?, NOW())`,
          [caseId, clientId, round, opts, source, adminId],
        )
      )[0].insertId;
    try {
      // Round 1: a normal full report whose Before is the enrollment PDF.
      const r1 = await session(1, "{}", "upload");
      const [src] = await pool.query<ResultSetHeader>(
        `INSERT INTO round_report_source_pdfs (session_id, role, file_name, storage_key, enc_iv, enc_tag, uploaded_by_admin_id)
         VALUES (?, 'before', 'enroll.pdf', 'vitest://score-update', REPEAT('0',32), REPEAT('0',32), ?)`,
        [r1, adminId],
      );
      await pool.query(`UPDATE report_wizard_sessions SET before_pdf_id = ? WHERE id = ?`, [src.insertId, r1]);
      await pool.query(`INSERT INTO client_round_reports (client_id, case_id, round_number, wizard_session_id, engine_json) VALUES (?, ?, 1, ?, ?)`, [
        clientId,
        caseId,
        r1,
        JSON.stringify({ engine: "progress_report_engine_v1" }),
      ]);
      // Round 3: a Score update whose Before was incomplete.
      const r3 = await session(3, '{"score_update":true}', beforeSource);
      await pool.query(`INSERT INTO client_round_reports (client_id, case_id, round_number, wizard_session_id, engine_json) VALUES (?, ?, 3, ?, ?)`, [
        clientId,
        caseId,
        r3,
        JSON.stringify({ engine: "score_update", incomplete_sides: ["before"] }),
      ]);
      const ctx = await auth(request(app).get(`/api/admin/cases/${caseId}/report-wizard/before-context`).query({ round_number: 4 }));
      expect(ctx.status).toBe(200);
      expect(ctx.body.context.can_reuse).toBe(!blocked);
      expect(ctx.body.context.reuse_blocked).toBe(blocked ? "incomplete_source" : undefined);
    } finally {
      await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
      await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ? AND status = 'published'`, [clientId]);
    }
  }, 60_000);
});
