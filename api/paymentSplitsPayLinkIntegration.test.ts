/**
 * Payment-split link + public /pay/:token coverage.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";

const RUN_ID = `split-pay-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let linkSplitId = 0;
let manualSplitId = 0;
let paidSplitId = 0;
let payToken = "";

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

describe(
  "payment splits — link vs manual + /pay/:token",
  { timeout: 30_000 },
  () => {
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
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-split-pay",
    );

    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Split', 'Pay', '+15555550111', 'en', 'active', 'new_client')`,
      [CLIENT_EMAIL],
    );
    clientId = clientIns.insertId;

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'new_client', 'active', ?)`,
      [clientId, RUN_ID],
    );
    caseId = caseIns.insertId;
    await pool.query(`UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`, [
      `CR-T${String(caseId).padStart(5, "0")}`,
      caseId,
    ]);
  }, 60_000);

  afterAll(async () => {
    if (clientId) {
      await pool.query(
        `DELETE FROM payment_split_tokens WHERE split_id IN
          (SELECT id FROM payment_splits WHERE client_id = ?)`,
        [clientId],
      );
      await pool.query(`DELETE FROM payment_splits WHERE client_id = ?`, [clientId]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    await pool?.end();
  });

  it("creates a payment-link installment with a token", async () => {
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const dueStr = due.toISOString().slice(0, 10);

    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Link installment",
        amount_cents: 25000,
        due_date: dueStr,
        send_payment_link: true,
        reminder_flow_id: null,
      })
      .expect(201);

    linkSplitId = Number(res.body.split.id);
    expect(res.body.split.send_payment_link).toBeTruthy();
    expect(res.body.split.payment_token).toBeTruthy();
    payToken = String(res.body.split.payment_token);
  });

  it("creates a manual installment without a token", async () => {
    const due = new Date();
    due.setDate(due.getDate() + 21);
    const dueStr = due.toISOString().slice(0, 10);

    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Manual installment",
        amount_cents: 10000,
        due_date: dueStr,
        send_payment_link: false,
        reminder_flow_id: null,
      })
      .expect(201);

    manualSplitId = Number(res.body.split.id);
    expect(Number(res.body.split.send_payment_link)).toBe(0);
    expect(res.body.split.payment_token == null).toBe(true);
  });

  it("creates an already-paid installment without a token", async () => {
    const due = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Prepaid installment",
        amount_cents: 5000,
        due_date: due,
        send_payment_link: true, // should be forced off by mark_as_paid
        mark_as_paid: true,
        reminder_flow_id: null,
      })
      .expect(201);

    paidSplitId = Number(res.body.split.id);
    expect(res.body.split.status).toBe("paid");
    expect(res.body.split.completion_source).toBe("manual");
    expect(res.body.split.payment_token == null).toBe(true);
  });

  it("GET /api/pay/:token returns split info for a valid link", async () => {
    const res = await request(app).get(`/api/pay/${payToken}`).expect(200);
    expect(res.body.split.label).toBe("Link installment");
    expect(res.body.split.amount_cents).toBe(25000);
  });

  it("GET /api/pay/:token returns 404 for unknown token", async () => {
    await request(app)
      .get("/api/pay/not-a-real-token-zzzz")
      .expect(404);
  });

  it("can generate a payment link on a manual installment via PUT", async () => {
    const res = await request(app)
      .put(`/api/admin/cases/${caseId}/splits/${manualSplitId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ send_payment_link: true })
      .expect(200);

    expect(res.body.split.payment_token).toBeTruthy();
    expect(Number(res.body.split.send_payment_link)).toBe(1);

    await request(app)
      .get(`/api/pay/${res.body.split.payment_token}`)
      .expect(200);
  });

  it("GET /api/pay/:token returns 410 once the split is marked paid", async () => {
    await request(app)
      .put(`/api/admin/cases/${caseId}/splits/${linkSplitId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "paid", completion_source: "manual" })
      .expect(200);

    await request(app).get(`/api/pay/${payToken}`).expect(410);
  });
  },
);
