/**
 * Reset Round (1b/2b/3a/4b/5b/6a/7b): dry-run, cascade, ACL, notify cleanup.
 * Requires DB_HOST + JWT_SECRET.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createServer, createSession } from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
  uniqueTestE164,
} from "./testDbCleanup";

const RUN_ID = `rrreset-${Date.now()}`;
let seedSeq = 0;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let agentToken = "";
const clientIds: number[] = [];

async function seedClientWithRounds(opts: {
  stage: string;
  rounds: number[];
  history?: Array<{ from: string; to: string; round: number }>;
}): Promise<{
  clientId: number;
  caseId: number;
  reports: Record<number, number>;
  pdfs: Record<number, number>;
  sessions: Record<number, number>;
}> {
  seedSeq += 1;
  const phone = uniqueTestE164(`rr-${RUN_ID}-seq-${seedSeq}`);
  const email = `reset-${RUN_ID}-${seedSeq}@example.test`;
  const [cliIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients
       (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
     VALUES ('Reset', ?, ?, ?, 'active', ?, 'en')`,
    [`Edge-${seedSeq}`, email, phone, opts.stage],
  );
  const clientId = Number(cliIns.insertId);
  clientIds.push(clientId);

  const [caseIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
     VALUES (?, ?, 'active')`,
    [clientId, opts.stage],
  );
  const caseId = Number(caseIns.insertId);
  await pool.query(
    `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
    [`CR${caseId}`, caseId],
  );

  for (const h of opts.history || []) {
    await pool.query(
      `INSERT INTO client_pipeline_history
         (client_id, from_stage, to_stage, changed_by_admin_id, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [
        clientId,
        h.from,
        h.to,
        adminId,
        `OFG Progress Report published — Round ${h.round} (vitest)`,
      ],
    );
  }

  const reports: Record<number, number> = {};
  const pdfs: Record<number, number> = {};
  const sessions: Record<number, number> = {};

  for (const rn of opts.rounds) {
    const [rrIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after,
          items_removed, items_disputed, summary_md, report_locale)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'en')`,
      [
        clientId,
        caseId,
        rn,
        500 + rn * 10,
        540 + rn * 10,
        `R${rn} fixture ${RUN_ID}`,
      ],
    );
    reports[rn] = Number(rrIns.insertId);

    const [pdfIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO round_report_pdfs
         (client_id, round_number, round_report_id, file_name, storage_key, storage_provider)
       VALUES (?, ?, ?, ?, ?, 'local')`,
      [
        clientId,
        rn,
        reports[rn],
        `R${rn}-${RUN_ID}.pdf`,
        `vitest://r${rn}-${clientId}-${RUN_ID}.pdf`,
      ],
    );
    pdfs[rn] = Number(pdfIns.insertId);

    const [sessIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, created_by_admin_id,
          output_pdf_id, round_report_id, published_at)
       VALUES (?, ?, ?, 'published', ?, ?, ?, NOW())`,
      [caseId, clientId, rn, adminId, pdfs[rn], reports[rn]],
    );
    sessions[rn] = Number(sessIns.insertId);

    await pool.query(
      `UPDATE client_round_reports SET wizard_session_id = ? WHERE id = ?`,
      [sessions[rn], reports[rn]],
    );
  }

  return { clientId, caseId, reports, pdfs, sessions };
}

describe("round report reset", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, role FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY FIELD(role,'super_admin','admin'), id ASC
       LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin/super_admin for integration tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-round-reset",
    );

    const [agents] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role = 'agent'
       ORDER BY id ASC LIMIT 1`,
    );
    if (agents[0]) {
      agentToken = await createSession(
        "admin",
        Number(agents[0].id),
        String(agents[0].email),
        "127.0.0.1",
        "vitest-round-reset-agent",
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of clientIds) {
        await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [
          id,
        ]);
        await pool.query(
          `DELETE FROM reminder_flow_executions WHERE client_id = ?`,
          [id],
        );
        await pool.query(
          `DELETE FROM report_wizard_staged_pdfs WHERE client_id = ?`,
          [id],
        );
        await pool.query(`DELETE FROM round_report_pdfs WHERE client_id = ?`, [
          id,
        ]);
        await pool.query(
          `DELETE FROM report_wizard_sessions WHERE client_id = ?`,
          [id],
        );
        await pool.query(
          `DELETE FROM client_round_reports WHERE client_id = ?`,
          [id],
        );
        await pool.query(
          `DELETE FROM client_pipeline_history WHERE client_id = ?`,
          [id],
        );
      }
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds,
      });
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("dry-run preview lists cascade + pipeline target from history", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_3",
      rounds: [1, 2],
      history: [
        { from: "docs_ready", to: "round_2", round: 1 },
        { from: "round_2", to: "round_3", round: 2 },
      ],
    });

    const res = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: false })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.preview.rounds_with_data).toEqual([1, 2]);
    expect(res.body.preview.pipeline.from).toBe("round_3");
    expect(res.body.preview.pipeline.to).toBe("docs_ready");
    // Undelivered fixtures → no email/SMS warning
    expect(res.body.preview.warnings || []).toEqual([]);

    const [still] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM client_round_reports WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(Number(still[0].c)).toBe(2);
  });

  it("confirm=true cascades clear, rolls pipeline, cancels pending notify, opens republish", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_3",
      rounds: [1, 2],
      history: [
        { from: "docs_ready", to: "round_2", round: 1 },
        { from: "round_2", to: "round_3", round: 2 },
      ],
    });

    // Seed pending round-complete queue + recent execution (idempotency trap)
    const [flows] = await pool.query<RowDataPacket[]>(
      `SELECT id, trigger_event FROM reminder_flows
       WHERE trigger_event IN ('round_1_complete','round_2_complete')
         AND is_active = 1`,
    );
    for (const f of flows) {
      await pool.query(
        `INSERT INTO reminder_flow_executions
           (flow_id, client_id, status, steps_executed, steps_scheduled)
         VALUES (?, ?, 'completed', 1, 0)`,
        [f.id, seeded.clientId],
      );
    }
    await pool.query(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, payload_json, status)
       VALUES (?, 'email', ?, 'Round 1', 'body', DATE_ADD(NOW(), INTERVAL 1 DAY), ?, 'pending')`,
      [
        seeded.clientId,
        `pending-${RUN_ID}@example.test`,
        JSON.stringify({ trigger_event: "round_1_complete" }),
      ],
    );

    const res = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: true })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.dry_run).toBe(false);
    expect(res.body.reset.rounds_with_data).toEqual([1, 2]);
    expect(res.body.reset.pipeline.to).toBe("docs_ready");

    const [reports] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM client_round_reports WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(reports).toHaveLength(0);

    const [pdfs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM round_report_pdfs WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(pdfs).toHaveLength(0);

    const [sessions] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM report_wizard_sessions WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(sessions).toHaveLength(0);

    const [cli] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM clients WHERE id = ?`,
      [seeded.clientId],
    );
    expect(cli[0].pipeline_stage).toBe("docs_ready");

    const [pending] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM notification_queue
       WHERE client_id = ? AND subject = 'Round 1'`,
      [seeded.clientId],
    );
    expect(pending[0]?.status).toBe("cancelled");

    if (flows.length) {
      const [execs] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM reminder_flow_executions
         WHERE client_id = ?`,
        [seeded.clientId],
      );
      expect(Number(execs[0].c)).toBe(0);
    }

    // Republish path open
    const [newRr] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after,
          items_removed, items_disputed, summary_md, report_locale)
       VALUES (?, ?, 1, 505, 545, 1, 1, 'R1 after reset', 'en')`,
      [seeded.clientId, seeded.caseId],
    );
    expect(Number(newRr.insertId)).toBeGreaterThan(0);
  });

  it("reset Round 2 leaves Round 1 intact and targets history from_stage", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_3",
      rounds: [1, 2],
      history: [
        { from: "docs_ready", to: "round_2", round: 1 },
        { from: "round_2", to: "round_3", round: 2 },
      ],
    });

    const res = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/2/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: true })
      .expect(200);

    expect(res.body.reset.rounds_with_data).toEqual([2]);
    expect(res.body.reset.pipeline.to).toBe("round_2");

    const [left] = await pool.query<RowDataPacket[]>(
      `SELECT round_number FROM client_round_reports
       WHERE client_id = ? ORDER BY round_number`,
      [seeded.clientId],
    );
    expect(left.map((r) => Number(r.round_number))).toEqual([1]);

    const [pdfs] = await pool.query<RowDataPacket[]>(
      `SELECT round_number FROM round_report_pdfs WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(pdfs.map((p) => Number(p.round_number))).toEqual([1]);
  });

  it("falls back to round_N when publish history missing", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_2",
      rounds: [1],
      // no history
    });

    const res = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: false })
      .expect(200);

    expect(res.body.preview.pipeline.to).toBe("round_1");
  });

  it("404 when nothing to reset", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_1",
      rounds: [],
    });

    const res = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: false })
      .expect(404);

    expect(String(res.body.error || "")).toMatch(/nothing to reset/i);
  });

  it("agent role cannot reset (403)", async () => {
    if (!agentToken) return; // skip when no agent fixture in DB

    const seeded = await seedClientWithRounds({
      stage: "round_2",
      rounds: [1],
      history: [{ from: "docs_ready", to: "round_2", round: 1 }],
    });

    await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ confirm: false })
      .expect(403);
  });

  it("legacy PDF DELETE returns 410 pointing to Reset Round", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_2",
      rounds: [1],
      history: [{ from: "docs_ready", to: "round_2", round: 1 }],
    });

    const res = await request(app)
      .delete(`/api/admin/round-report-pdfs/${seeded.pdfs[1]}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(410);

    expect(String(res.body.error || "")).toMatch(/deprecated/i);
    expect(res.body.reset_path).toContain(
      `/round-reports/1/reset`,
    );

    // PDF row still present
    const [pdfs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM round_report_pdfs WHERE id = ?`,
      [seeded.pdfs[1]],
    );
    expect(pdfs).toHaveLength(1);
  });

  it("session-only draft is resettable; no email warning when not delivered", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_1",
      rounds: [],
    });

    const [sessIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, created_by_admin_id)
       VALUES (?, ?, 1, 'draft', ?)`,
      [seeded.caseId, seeded.clientId, adminId],
    );
    const sessionId = Number(sessIns.insertId);

    const preview = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: false })
      .expect(200);

    expect(preview.body.preview.rounds_with_data).toEqual([1]);
    expect(preview.body.preview.session_ids).toEqual([sessionId]);
    expect(preview.body.preview.warnings || []).toEqual([]);

    await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: true })
      .expect(200);

    const [left] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM report_wizard_sessions WHERE client_id = ?`,
      [seeded.clientId],
    );
    expect(left).toHaveLength(0);
  });

  it("clears unconsumed staged PDFs and includes email warning when delivered", async () => {
    const seeded = await seedClientWithRounds({
      stage: "round_2",
      rounds: [1],
      history: [{ from: "docs_ready", to: "round_2", round: 1 }],
    });

    await pool.query(
      `UPDATE client_round_reports
       SET delivered_via_email = 1
       WHERE id = ?`,
      [seeded.reports[1]],
    );

    const [stagedIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_staged_pdfs
         (case_id, client_id, file_name, storage_key, storage_provider,
          encrypted, enc_iv, enc_tag, byte_size, uploaded_by_admin_id, expires_at)
       VALUES (?, ?, ?, ?, 'local', 0, '0', '0', 12, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [
        seeded.caseId,
        seeded.clientId,
        `staged-${RUN_ID}.pdf`,
        `vitest://staged-${seeded.clientId}-${RUN_ID}.pdf`,
        adminId,
      ],
    );
    const stagedId = Number(stagedIns.insertId);

    const preview = await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: false })
      .expect(200);

    expect(preview.body.preview.staged_pdf_ids).toEqual(
      expect.arrayContaining([stagedId]),
    );
    expect(preview.body.preview.warnings?.length).toBeGreaterThan(0);

    await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm: true })
      .expect(200);

    const [stagedLeft] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM report_wizard_staged_pdfs WHERE id = ?`,
      [stagedId],
    );
    expect(stagedLeft).toHaveLength(0);
  });

  it("affiliate admin cannot reset (403)", async () => {
    const [aff] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role = 'affiliate'
       ORDER BY id ASC LIMIT 1`,
    );
    if (!aff[0]) return;

    const affToken = await createSession(
      "admin",
      Number(aff[0].id),
      String(aff[0].email),
      "127.0.0.1",
      "vitest-round-reset-aff",
    );

    const seeded = await seedClientWithRounds({
      stage: "round_2",
      rounds: [1],
      history: [{ from: "docs_ready", to: "round_2", round: 1 }],
    });

    await request(app)
      .post(`/api/admin/clients/${seeded.clientId}/round-reports/1/reset`)
      .set("Authorization", `Bearer ${affToken}`)
      .send({ confirm: false })
      .expect(403);
  });
});
