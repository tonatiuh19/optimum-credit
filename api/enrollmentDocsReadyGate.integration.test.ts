/**
 * Enrollment / Docs Verified gates — prevent active-without-case and empty docs_ready.
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
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `enroll-gate-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;

describe("enrollment + docs_ready gates", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status = 'active' AND role IN ('super_admin','admin') ORDER BY id ASC LIMIT 1`,
    );
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-enrollment-gate",
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES (?, 'Gate', ?, '15550001111', 'prospect', 'prospect', 'en')`,
      [`${RUN_ID}@example.test`, RUN_ID],
    );
    clientId = Number(ins.insertId);
  }, 60_000);

  afterAll(async () => {
    if (pool && clientId) {
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: [clientId],
      }).catch(() => {});
    }
    await pool?.end().catch(() => {});
  });

  it("blocks PUT status=active without enrolled case", async () => {
    const res = await request(app)
      .put(`/api/admin/clients/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("use_convert_prospect");
  });

  it("blocks docs_ready when case has zero approved required tasks", async () => {
    const convert = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ package_id: 1, notes: `gate-${RUN_ID}` });
    expect([200, 201]).toContain(convert.status);
    caseId = Number(convert.body.case_id || convert.body.case?.id);
    if (!caseId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM credit_repair_cases WHERE client_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [clientId],
      );
      caseId = Number(rows[0]?.id);
    }
    expect(caseId).toBeGreaterThan(0);

    // Ensure tasks exist but are not approved
    await pool.query(
      `UPDATE client_task_completions SET admin_review_status = 'pending', status = 'pending'
       WHERE case_id = ?`,
      [caseId],
    );

    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "docs_ready" });
    expect(res.status).toBe(422);
    expect(String(res.body.error || "")).toMatch(/required task/i);
  }, 60_000);
});
