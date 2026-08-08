/**
 * Regression: admin dashboard must tolerate score drops (UNSIGNED subtraction).
 * Prod error: BIGINT UNSIGNED value is out of range in '(551 - 632)'
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createServer, createSession } from "./index";
import { cleanupIntegrationTestClients } from "./testDbCleanup";

const RUN_ID = `dash-test-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let reportId = 0;

describe("admin dashboard — score drop regression", () => {
  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 4000),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: true },
      connectionLimit: 2,
    });
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for dashboard test");
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-dashboard",
    );

    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, status, pipeline_stage)
       VALUES (?, 'Dash', 'Drop', 'active', 'round_2')`,
      [`${RUN_ID}@example.test`],
    );
    clientId = cIns.insertId;

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'round_2', 'active', ?)`,
      [clientId, RUN_ID],
    );
    caseId = caseIns.insertId;

    // Reproduce prod case: after < before (551 - 632) under UNSIGNED columns
    const [rIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after, items_removed, items_disputed)
       VALUES (?, ?, 1, 632, 551, 10, 6)`,
      [clientId, caseId],
    );
    reportId = rIns.insertId;
  }, 60_000);

  afterAll(async () => {
    try {
      if (reportId)
        await pool.query(`DELETE FROM client_round_reports WHERE id = ?`, [
          reportId,
        ]);
      if (clientId)
        await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: [clientId],
      });
    } finally {
      await pool?.end();
    }
  }, 30_000);

  it("returns 200 even when avg includes a negative score delta", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeTruthy();
    expect(res.body.stats.avg_score_improvement).not.toBeNull();
    // Average may be negative or positive depending on other rows; must be numeric
    expect(Number.isFinite(Number(res.body.stats.avg_score_improvement))).toBe(
      true,
    );
  }, 20_000);

  it("SQL delta for drop rows is negative when cast to SIGNED", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(score_after AS SIGNED) - CAST(score_before AS SIGNED) AS delta
       FROM client_round_reports WHERE id = ?`,
      [reportId],
    );
    expect(Number(rows[0].delta)).toBe(551 - 632);
  });
});
