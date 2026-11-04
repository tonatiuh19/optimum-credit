/**
 * Progress Report enhancement — Preview keeps today's 3-page PDF until both
 * Before + After enhanced reads are ready, then appends account-detail pages.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { OfGReportData } from "@shared/api";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";
import { FILE, acct, tl } from "./creditAnalysisFixtures";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let adminId = 0;
let clientId = 0;
let caseId = 0;
let sessionId = 0;

const DATA: OfGReportData = {
  client: { firstName: "Enh", lastName: "Wizard" },
  reportDate: { before: "2026-10-01", after: "2026-11-05" },
  bureauScores: {
    transunion: { before: 511, after: 548 },
    experian: { before: 555, after: 590 },
    equifax: { before: 560, after: 580 },
  },
  middleScore: { before: 555, after: 580 },
  wins: [{ itemRemoved: "Leafy Financial collection", bureaus: ["TU", "EX"], impact: "High", status: "Deleted" }],
  targets: [{ item: "Eagle CU charge-off", bureaus: ["TU", "EX"], detail: "Next round", priority: "high" }],
  utilization: [],
  positiveAccounts: ["On-time history"],
  actionNeeded: [],
  roadmap: { currentRound: 1, nextRound: 2, scoreGoal: 650, gapRemaining: 70, milestones: ["Round 2"] },
  actionPlan: [{ step: 1, description: "Keep paying on time", owner: "client" }],
  fileStrengthScore: 60,
  croaDisclosure: "Results vary. CROA disclosure.",
  locale: "en",
};

async function previewFull(): Promise<{ pages: number; text: string; flags: Array<{ code: string; message: string }> }> {
  const res = await request(app)
    .post(`/api/admin/report-wizard/sessions/${sessionId}/preview`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({})
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const buf = res.body as Buffer;
  await import("pdf-parse/worker").catch(() => undefined);
  const { PDFParse } = await import("pdf-parse");
  return {
    pages: (await PDFDocument.load(buf)).getPageCount(),
    text: (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " "),
    flags: JSON.parse(decodeURIComponent(String(res.headers["x-report-review-flags"] || "%5B%5D"))),
  };
}

describe("progress report enhancement (preview)", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status = 'active'
       AND role IN ('super_admin','admin') ORDER BY id ASC LIMIT 1`,
    );
    adminId = Number(admins[0].id);
    adminToken = await createSession("admin", adminId, String(admins[0].email), "127.0.0.1", "vitest-enh");
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Enh', 'Wizard', ?, 'active', 'round_1')`,
      [`enh-wiz-${Date.now()}@example.test`],
    );
    clientId = c.insertId;
    const [k] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_1', 'active')`,
      [clientId],
    );
    caseId = k.insertId;
    const [s] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, options_json, extracted_json, created_by_admin_id)
       VALUES (?, ?, 1, 'review', '{}', ?, ?)`,
      [caseId, clientId, JSON.stringify(DATA), adminId],
    );
    sessionId = s.insertId;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM credit_file_extractions WHERE report_wizard_session_id = ?`, [sessionId]);
    await pool.query(`DELETE FROM report_wizard_sessions WHERE id = ?`, [sessionId]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await pool.end();
  });

  // Engine Spec v1 PR-P0-1: no text fallback — Preview waits for both reads.
  const previewRaw = () =>
    request(app)
      .post(`/api/admin/report-wizard/sessions/${sessionId}/preview`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

  it("v2: Preview is gated until both account-level reads are ready (no text fallback)", async () => {
    // No reads and no stored source PDF → needs review (reads_failed), never a text-built report.
    const none = await previewRaw();
    expect(none.status).toBe(422);
    expect(none.body.code).toBe("reads_failed");
    await pool.query(
      `INSERT INTO credit_file_extractions
         (client_id, case_id, report_wizard_session_id, purpose, file_name, mime_type, file_size,
          storage_key, enc_iv, enc_tag, status, extracted_json)
       VALUES (?, ?, ?, 'progress_before', 'b.pdf', 'application/pdf', 1, 'vitest://none',
               REPEAT('0',32), REPEAT('0',32), 'ready', ?)`,
      [clientId, caseId, sessionId, JSON.stringify(FILE)],
    );
    // Before ready, After still reading → 409 reads_pending with per-pull status.
    await pool.query(
      `INSERT INTO credit_file_extractions
         (client_id, case_id, report_wizard_session_id, purpose, file_name, mime_type, file_size,
          storage_key, enc_iv, enc_tag, status)
       VALUES (?, ?, ?, 'progress_after', 'a.pdf', 'application/pdf', 1, 'vitest://none',
               REPEAT('0',32), REPEAT('0',32), 'submitted')`,
      [clientId, caseId, sessionId],
    );
    const half = await previewRaw();
    expect(half.status).toBe(409);
    expect(half.body.code).toBe("reads_pending");
    expect(half.body.reads).toMatchObject({ before: { status: "ready" }, after: { status: "reading" } });
    const status = await request(app).get(`/api/admin/report-wizard/sessions/${sessionId}/reads`).set("Authorization", `Bearer ${adminToken}`);
    expect(status.body).toMatchObject({ ready: false, reads: { before: { status: "ready" }, after: { status: "reading" } } });
    await pool.query(`DELETE FROM credit_file_extractions WHERE report_wizard_session_id = ? AND purpose = 'progress_after'`, [sessionId]);
  }, 60_000);

  it("v2: account-level wins/targets once Before and After are both ready", async () => {
    const after = {
      ...FILE,
      reportDate: "11/05/2026",
      accounts: [
        ...FILE.accounts.filter((a) => a.creditor !== "LEAFY FINANCIAL"),
        acct({ creditor: "KLARNA", section: "installment", bureaus: { TU: tl({ paymentStatus: "Late 30 Days", late30: 1 }) } }),
      ],
    };
    await pool.query(
      `INSERT INTO credit_file_extractions
         (client_id, case_id, report_wizard_session_id, purpose, file_name, mime_type, file_size,
          storage_key, enc_iv, enc_tag, status, extracted_json)
       VALUES (?, ?, ?, 'progress_after', 'a.pdf', 'application/pdf', 1, 'vitest://none',
               REPEAT('0',32), REPEAT('0',32), 'ready', ?)`,
      [clientId, caseId, sessionId, JSON.stringify(after)],
    );
    const full = await previewFull();
    expect(full.pages).toBe(3);
    expect(full.flags.map((f) => f.code)).not.toContain("parse_failure");
    // LEAFY removed → win; KLARNA new late → target + internal note.
    expect(full.text).toMatch(/What Came Off Your Report.*LEAFY FINANCIAL/);
    expect(full.text).toMatch(/What Is Still On Your Report.*KLARNA/);
    const ready = await request(app).get(`/api/admin/report-wizard/sessions/${sessionId}/reads`).set("Authorization", `Bearer ${adminToken}`);
    expect(ready.body.ready).toBe(true);
    // Undated → not "new" (only items dated after the baseline are new); staff get a note to check the Before.
    expect(full.flags.some((f) => f.code === "internal_note" && /Not on the Before read \(no open date.*KLARNA/.test(f.message))).toBe(true);
    expect(full.text).not.toMatch(/What Moved Your Score/);
  }, 60_000);

  it("v2: identical pulls are BLOCKED_DATA_INTEGRITY for everyone (PR-P0-5)", async () => {
    const [ag] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Agent', 'NonOwner', 'agent', 'active', 'en')`,
      [`enh-agent-${Date.now()}@example.test`],
    );
    try {
      const agentToken = await createSession("admin", ag.insertId, `agent-${ag.insertId}@example.test`, "127.0.0.1", "vitest-enh");
      // Same pull twice → same_pull flag (blocking).
      await pool.query(
        `UPDATE credit_file_extractions SET extracted_json = ? WHERE report_wizard_session_id = ?`,
        [JSON.stringify(FILE), sessionId],
      );
      const res = await request(app)
        .post(`/api/admin/report-wizard/sessions/${sessionId}/finalize`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send({ compliance_acknowledged: true, acknowledge_score_anomalies: true });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("blocked_data_integrity");
      expect(res.body.error).toMatch(/same report date/);
      const [st] = await pool.query<RowDataPacket[]>(`SELECT status FROM report_wizard_sessions WHERE id = ?`, [sessionId]);
      expect(st[0].status).toBe("review");
    } finally {
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [ag.insertId]).catch(() => undefined);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [ag.insertId]);
    }
  }, 60_000);

  it("GF-84: old rounds default to a silent publish (notify-default)", async () => {
    const get = () =>
      request(app)
        .get(`/api/admin/report-wizard/sessions/${sessionId}/notify-default`)
        .set("Authorization", `Bearer ${adminToken}`);
    // Recent After date, nothing newer → notify.
    let res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notify_client: true, reasons: [] });

    // After report 45+ days old → silent, with the reason.
    const old = { ...DATA, reportDate: { before: "2025-01-01", after: "2025-02-01" } };
    await pool.query(`UPDATE report_wizard_sessions SET reviewed_json = ? WHERE id = ?`, [JSON.stringify(old), sessionId]);
    res = await get();
    expect(res.body.notify_client).toBe(false);
    expect(res.body.reasons.join(" ")).toMatch(/days old/);

    // A newer round already published → silent.
    await pool.query(`UPDATE report_wizard_sessions SET reviewed_json = NULL WHERE id = ?`, [sessionId]);
    const [rr] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports (client_id, case_id, round_number, score_before, score_after, items_removed, items_disputed)
       VALUES (?, ?, 3, 600, 620, 0, 0)`,
      [clientId, caseId],
    );
    try {
      res = await get();
      expect(res.body.notify_client).toBe(false);
      expect(res.body.reasons.join(" ")).toMatch(/Round 3 is already published/);
    } finally {
      await pool.query(`DELETE FROM client_round_reports WHERE id = ?`, [rr.insertId]);
    }
  }, 60_000);
});
