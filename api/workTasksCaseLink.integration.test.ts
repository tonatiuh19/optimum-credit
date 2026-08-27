/**
 * Work Hub case link + calendar/dashboard surfaces.
 * Requires DB_HOST + JWT_SECRET.
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
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `wt-case-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
const clientIds: number[] = [];
const caseIds: number[] = [];
const taskIds: number[] = [];

describe("work tasks case link — calendar + dashboard", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = createIntegrationTestPool();
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
      "vitest-wt-case",
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of taskIds) {
      await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [id]).catch(() => {});
    }
    for (const id of caseIds) {
      await pool
        .query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id])
        .catch(() => {});
    }
    await cleanupIntegrationTestClients(pool, {
      clientIds,
      runId: RUN_ID,
    });
    await pool.end();
  }, 60_000);

  it("links a case on create, surfaces on calendar + dashboard, unlinks", async () => {
    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Work', 'TaskCase', ?, 'active', 'new_client')`,
      [`${RUN_ID}@example.test`],
    );
    const clientId = Number(clientIns.insertId);
    clientIds.push(clientId);

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'new_client', 'active')`,
      [clientId],
    );
    const caseId = Number(caseIns.insertId);
    caseIds.push(caseId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-WT${caseId}`, caseId],
    );

    const due = "2030-06-15";
    const created = await request(app)
      .post("/api/admin/work-tasks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: `${RUN_ID} linked task`,
        status: "backlog",
        priority: "high",
        due_at: due,
        assignee_admin_id: adminId,
        case_id: caseId,
      })
      .expect(201);

    const task = created.body.task;
    taskIds.push(Number(task.id));
    expect(task.case_id).toBe(caseId);
    expect(task.case_number).toBe(`CR-WT${caseId}`);
    expect(task.client_id).toBe(clientId);

    const search = await request(app)
      .get("/api/admin/work-tasks/case-search")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: `CR-WT${caseId}` })
      .expect(200);
    expect(search.body.cases.some((c: any) => c.case_id === caseId)).toBe(true);

    const cal = await request(app)
      .get("/api/admin/calendar")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ from: "2030-06-01", to: "2030-06-30" })
      .expect(200);
    expect(Array.isArray(cal.body.work_tasks)).toBe(true);
    expect(
      cal.body.work_tasks.some(
        (t: any) => t.id === task.id && t.due_date === due,
      ),
    ).toBe(true);

    const dash = await request(app)
      .get("/api/admin/dashboard")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(dash.body.my_work_tasks)).toBe(true);
    expect(
      dash.body.my_work_tasks.some((t: any) => t.id === task.id),
    ).toBe(true);

    await request(app)
      .put(`/api/admin/work-tasks/${task.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ case_id: null })
      .expect(200)
      .expect((res) => {
        expect(res.body.task.case_id).toBeNull();
      });
  });

  it("supports server search and per-column pagination", async () => {
    const stamp = `${RUN_ID}-page`;
    for (let i = 0; i < 3; i++) {
      const created = await request(app)
        .post("/api/admin/work-tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: `${stamp} done ${i}`,
          status: "done",
          priority: "medium",
        })
        .expect(201);
      taskIds.push(Number(created.body.task.id));
    }

    const board = await request(app)
      .get("/api/admin/work-tasks")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: stamp, limit: 2 })
      .expect(200);
    expect(board.body.columns?.done?.total).toBeGreaterThanOrEqual(3);
    expect(board.body.columns.done.tasks.length).toBeLessThanOrEqual(2);
    expect(board.body.columns.done.has_more).toBe(true);

    const more = await request(app)
      .get("/api/admin/work-tasks")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: stamp, status: "done", offset: 2, limit: 2 })
      .expect(200);
    expect(more.body.status).toBe("done");
    expect(more.body.tasks.length).toBeGreaterThanOrEqual(1);
    expect(more.body.total).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid case_id on create", async () => {
    await request(app)
      .post("/api/admin/work-tasks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: `${RUN_ID} bad case`,
        case_id: 999999999,
      })
      .expect(400);
  });

  it("case-search includes completed cases and excludes cancelled", async () => {
    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Done', 'CaseSearch', ?, 'active', 'completed')`,
      [`${RUN_ID}-done@example.test`],
    );
    const clientId = Number(clientIns.insertId);
    clientIds.push(clientId);

    const [doneIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'completed', 'completed')`,
      [clientId],
    );
    const doneId = Number(doneIns.insertId);
    caseIds.push(doneId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-DONE${doneId}`, doneId],
    );

    const [cancelIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'cancelled', 'cancelled')`,
      [clientId],
    );
    const cancelId = Number(cancelIns.insertId);
    caseIds.push(cancelId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-CAN${cancelId}`, cancelId],
    );

    const search = await request(app)
      .get("/api/admin/work-tasks/case-search")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: `CR-DONE${doneId}` })
      .expect(200);
    const hit = search.body.cases.find((c: any) => c.case_id === doneId);
    expect(hit).toBeTruthy();
    expect(hit.case_status).toBe("completed");

    const cancelled = await request(app)
      .get("/api/admin/work-tasks/case-search")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: `CR-CAN${cancelId}` })
      .expect(200);
    expect(
      cancelled.body.cases.some((c: any) => c.case_id === cancelId),
    ).toBe(false);
  });
});
