/**
 * Graduating client email — stage → completed fires Cesar’s celebration
 * template (EN/ES) via the existing reminder flow pattern.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  createServer,
  createSession,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
} from "./index";
import { cleanupIntegrationTestClients } from "./testDbCleanup";

const RUN_ID = `grad-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
const clientIds: number[] = [];
const caseIds: number[] = [];

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

async function insertClient(opts: {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  preferred_language: "en" | "es";
}) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients
       (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
     VALUES (?, ?, ?, ?, 'onboarding', 'round_5', ?)`,
    [
      opts.first_name,
      opts.last_name,
      opts.email ?? null,
      opts.phone ?? null,
      opts.preferred_language,
    ],
  );
  const id = Number(r.insertId);
  clientIds.push(id);
  return id;
}

async function insertCase(clientId: number) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases
       (client_id, pipeline_stage, status, notes)
     VALUES (?, 'round_5', 'active', ?)`,
    [clientId, RUN_ID],
  );
  const id = Number(r.insertId);
  await pool.query(
    `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
    [`CR-G${String(id).padStart(5, "0")}`, id],
  );
  caseIds.push(id);
  return id;
}

describe("graduating client email — completed stage", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = await makePool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-graduating",
    );

    const [tmpl] = await pool.query<RowDataPacket[]>(
      `SELECT subject FROM communication_templates
       WHERE slug = 'flow_completed' AND is_active = 1 LIMIT 1`,
    );
    if (!tmpl[0]?.subject?.includes("Credit File Is Clean")) {
      throw new Error(
        "flow_completed template missing graduating subject — apply 20260806_093000_graduating_client_email.sql",
      );
    }
  }, 60_000);

  afterAll(async () => {
    for (const id of clientIds) {
      await pool.query(`DELETE FROM reminder_flow_executions WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        id,
      ]);
    }
    for (const id of caseIds) {
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id]);
    }
    for (const id of clientIds) {
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    await pool?.end();
  }, 90_000);

  it("sends EN graduating celebration when case moves to completed", async () => {
    const clientId = await insertClient({
      first_name: "Grad",
      last_name: `En-${RUN_ID}`,
      email: `grad-en-${RUN_ID}@example.test`,
      preferred_language: "en",
    });
    const caseId = await insertCase(clientId);

    __testClearEmailDryRuns();

    await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "completed", notes: `graduating ${RUN_ID}` })
      .expect(200);

    // Fire-and-forget flow
    await new Promise((r) => setTimeout(r, 8_000));

    const mails = __testGetEmailDryRuns().filter((e) =>
      e.subject.includes("Credit File Is Clean"),
    );
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[0].to).toContain(`grad-en-${RUN_ID}@example.test`);

    const [flows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flows WHERE trigger_event = 'completed' AND is_active = 1 LIMIT 1`,
    );
    expect(flows.length).toBe(1);
    const [execs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flow_executions
       WHERE flow_id = ? AND client_id = ?
       ORDER BY id DESC LIMIT 1`,
      [flows[0].id, clientId],
    );
    expect(execs.length).toBe(1);
  }, 45_000);

  it("sends ES graduating celebration for Spanish clients", async () => {
    const clientId = await insertClient({
      first_name: "Graduado",
      last_name: `Es-${RUN_ID}`,
      email: `grad-es-${RUN_ID}@example.test`,
      preferred_language: "es",
    });
    const caseId = await insertCase(clientId);

    __testClearEmailDryRuns();

    await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "completed", notes: `graduando ${RUN_ID}` })
      .expect(200);

    await new Promise((r) => setTimeout(r, 8_000));

    const mails = __testGetEmailDryRuns().filter(
      (e) =>
        e.subject.includes("archivo de crédito está limpio") ||
        e.subject.includes("Felicidades"),
    );
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[0].to).toContain(`grad-es-${RUN_ID}@example.test`);
  }, 45_000);

  it("skips graduating email safely when client has no email", async () => {
    const clientId = await insertClient({
      first_name: "Phone",
      last_name: `Only-${RUN_ID}`,
      email: null,
      phone: "+15555550199",
      preferred_language: "en",
    });
    const caseId = await insertCase(clientId);

    __testClearEmailDryRuns();

    await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "completed", notes: `no-email ${RUN_ID}` })
      .expect(200);

    await new Promise((r) => setTimeout(r, 5_000));

    const mails = __testGetEmailDryRuns().filter((e) =>
      e.subject.includes("Credit File Is Clean"),
    );
    expect(mails.length).toBe(0);
  }, 30_000);
});
