/**
 * Smoke / integration: prospect lead → convert → tasks → docs_ready notify.
 * Requires DB_HOST + JWT_SECRET (same as other HTTP integration suites).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";

const RUN_ID = `pros-test-${Date.now()}`;
const PROSPECT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;

async function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectionLimit: 3,
  });
}

describe("prospects pipeline — HTTP smoke", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin user in DB for integration tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-prospects",
    );
  }, 60_000);

  afterAll(async () => {
    if (clientId) {
      await pool.query(`DELETE FROM reminder_flow_executions WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM client_task_completions WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [clientId]);
      await pool.query(`DELETE FROM credit_analyses WHERE client_id = ?`, [clientId]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    await pool?.end();
  });

  it("creates a prospect from get_started lead with source labels", async () => {
    const res = await request(app)
      .post("/api/public/prospect-lead")
      .send({
        first_name: "Pros",
        last_name: "Tester",
        email: PROSPECT_EMAIL,
        phone: "+15555550999",
        source_label: "web_analysis",
        lead_source: "get_started",
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    clientId = Number(res.body.client_id);
    expect(clientId).toBeGreaterThan(0);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(clients[0].status).toBe("prospect");
    expect(clients[0].pipeline_stage).toBe("prospect");

    const [labels] = await pool.query<RowDataPacket[]>(
      `SELECT l.slug FROM client_labels cl
       JOIN labels l ON l.id = cl.label_id
       WHERE cl.client_id = ?`,
      [clientId],
    );
    const slugs = labels.map((r) => r.slug as string);
    expect(slugs).toEqual(
      expect.arrayContaining(["web_analysis", "get_started_wizard"]),
    );
  });

  it("converts prospect → case + auto-assigns tasks", async () => {
    const res = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: `smoke ${RUN_ID}` })
      .expect(200);

    expect(res.body.client.status).toBe("onboarding");
    expect(res.body.client.pipeline_stage).toBe("new_client");
    caseId = Number(res.body.case.id);
    expect(caseId).toBeGreaterThan(0);
    expect(res.body.case.case_number).toMatch(/^CR-/);

    // autoAssignTasks is fire-and-forget — give it a moment
    await new Promise((r) => setTimeout(r, 800));

    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT id, status FROM client_task_completions WHERE client_id = ? AND case_id = ?`,
      [clientId, caseId],
    );
    expect(tasks.length).toBeGreaterThan(0);
  }, 20_000);

  it("advances to docs_ready after required tasks approved and records reminder execution", async () => {
    expect(caseId).toBeGreaterThan(0);

    await pool.query(
      `UPDATE client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       SET ctc.admin_review_status = 'approved', ctc.status = 'completed'
       WHERE ctc.case_id = ? AND ott.is_required = 1 AND ott.is_active = 1`,
      [caseId],
    );

    // Also approve any remaining required templates that weren't auto-assigned
    const [missing] = await pool.query<RowDataPacket[]>(
      `SELECT ott.id FROM onboarding_task_templates ott
       WHERE ott.is_active = 1 AND ott.is_required = 1
         AND NOT EXISTS (
           SELECT 1 FROM client_task_completions ctc
           WHERE ctc.case_id = ? AND ctc.task_template_id = ott.id
         )`,
      [caseId],
    );
    for (const row of missing) {
      await pool.query(
        `INSERT INTO client_task_completions
           (client_id, case_id, task_template_id, status, admin_review_status)
         VALUES (?, ?, ?, 'completed', 'approved')`,
        [clientId, caseId, row.id],
      );
    }

    await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "docs_ready", notes: `smoke docs_ready ${RUN_ID}` })
      .expect(200);

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("docs_ready");

    const [flows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flows WHERE trigger_event = 'docs_ready' AND is_active = 1 LIMIT 1`,
    );
    if (flows.length === 0) return; // seed may be absent in some envs

    // Fire-and-forget trigger — allow SMTP timeout fallback (~8s) + insert
    await new Promise((r) => setTimeout(r, 10_000));

    const [execs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flow_executions
       WHERE flow_id = ? AND client_id = ?
       ORDER BY id DESC LIMIT 1`,
      [flows[0].id, clientId],
    );
    expect(execs.length).toBe(1);
  }, 30_000);
});
