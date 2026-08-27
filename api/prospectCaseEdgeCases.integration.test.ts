/**
 * Edge cases: prospect-stage cases, convert reuse, stage/client bypasses,
 * pipeline visibility, and duplicate-case cleanup.
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

const RUN_ID = `pros-edge-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
const clientIds: number[] = [];
const caseIds: number[] = [];

async function createProspect(suffix: string): Promise<number> {
  const email = `${RUN_ID}-${suffix}@example.test`;
  const res = await request(app)
    .post("/api/public/prospect-lead")
    .send({
      first_name: "Edge",
      last_name: suffix,
      email,
      phone: "+15555550100",
      source_label: "web_analysis",
    })
    .expect(200);
  const id = Number(res.body.client_id);
  clientIds.push(id);
  return id;
}

async function createProspectCase(clientId: number, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/admin/cases")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      client_id: clientId,
      pipeline_stage: "prospect",
      notes: `edge ${RUN_ID}`,
      ...extra,
    });
  return res;
}

describe("prospect-stage case edge cases — HTTP", () => {
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
      "vitest-pros-edge",
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of clientIds) {
      await pool.query(`DELETE FROM reminder_flow_executions WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM client_task_completions WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM credit_analyses WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM payments WHERE client_id = ?`, [id]);
      await pool.query(
        `DELETE FROM case_round_schedules WHERE case_id IN (
           SELECT id FROM credit_repair_cases WHERE client_id = ?
         )`,
        [id],
      );
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    await pool?.end();
  }, 90_000);

  it("rejects pipeline_stage=prospect for non-prospect clients", async () => {
    const [rows] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Non', 'Prospect', ?, 'active', 'new_client')`,
      [`${RUN_ID}-active@example.test`],
    );
    const id = Number((rows as any).insertId);
    clientIds.push(id);

    const res = await createProspectCase(id);
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/status=prospect/i);
  });

  it("rejects non-prospect stages for prospect clients (must convert)", async () => {
    const clientId = await createProspect("must-convert");
    const res = await request(app)
      .post("/api/admin/cases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ client_id: clientId, pipeline_stage: "new_client" })
      .expect(409);
    expect(String(res.body.error)).toMatch(/convert/i);
  });

  it("rejects New Case create at docs_ready / mid-pipeline stages", async () => {
    const [rows] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Mid', 'Pipeline', ?, 'active', 'new_client')`,
      [`${RUN_ID}-midpipe@example.test`],
    );
    const id = Number((rows as any).insertId);
    clientIds.push(id);

    const res = await request(app)
      .post("/api/admin/cases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ client_id: id, pipeline_stage: "docs_ready" })
      .expect(400);
    expect(String(res.body.error)).toMatch(/prospect or new_client/i);
  });

  it("pipeline lists prospect with case_id and hides prospect-stage case from cases[]", async () => {
    const clientId = await createProspect("pipeline-vis");
    const created = await createProspectCase(clientId);
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    const pipe = await request(app)
      .get("/api/admin/pipeline")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ search: `${RUN_ID}-pipeline-vis` })
      .expect(200);

    const prospect = (pipe.body.prospects as any[]).find(
      (p) => Number(p.id) === clientId,
    );
    expect(prospect).toBeTruthy();
    expect(Number(prospect.case_id)).toBe(caseId);
    expect(prospect.case_number).toMatch(/^CR-/);

    const inCases = (pipe.body.cases as any[]).some(
      (c) => Number(c.id) === caseId,
    );
    expect(inCases).toBe(false);
  });

  it("does not silently persist round schedule on prospect create without send_calendar", async () => {
    const clientId = await createProspect("no-sched");
    const r1 = new Date();
    r1.setUTCDate(r1.getUTCDate() + 3);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const created = await createProspectCase(clientId, {
      round_schedule: {
        round_1_date: ymd(r1),
        round_2_date: ymd(new Date(r1.getTime() + 35 * 86400000)),
        round_3_date: ymd(new Date(r1.getTime() + 70 * 86400000)),
        round_4_date: ymd(new Date(r1.getTime() + 105 * 86400000)),
        round_5_date: ymd(new Date(r1.getTime() + 140 * 86400000)),
        interval_days: 35,
        send_calendar: false,
      },
    });
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    const [sched] = await pool.query<RowDataPacket[]>(
      `SELECT case_id FROM case_round_schedules WHERE case_id = ?`,
      [caseId],
    );
    expect(sched.length).toBe(0);
  });

  it("ignores notes, splits, and send_calendar on prospect-stage create (convert-time fields)", async () => {
    const clientId = await createProspect("ignore-convert-fields");
    const r1 = new Date();
    r1.setUTCDate(r1.getUTCDate() + 4);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const due = ymd(new Date(r1.getTime() + 14 * 86400000));

    const created = await createProspectCase(clientId, {
      notes: "should be ignored",
      package_id: 1,
      send_case_email: true,
      splits: [
        {
          label: "Deposit",
          amount_cents: 5000,
          due_date: due,
          send_payment_link: false,
        },
      ],
      round_schedule: {
        round_1_date: ymd(r1),
        round_2_date: ymd(new Date(r1.getTime() + 35 * 86400000)),
        round_3_date: ymd(new Date(r1.getTime() + 70 * 86400000)),
        round_4_date: ymd(new Date(r1.getTime() + 105 * 86400000)),
        round_5_date: ymd(new Date(r1.getTime() + 140 * 86400000)),
        interval_days: 35,
        send_calendar: true,
      },
    });
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT notes, package_id, pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("prospect");
    expect(cases[0].notes).toBeNull();
    expect(cases[0].package_id).toBeNull();

    const [splits] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM payment_splits WHERE case_id = ?`,
      [caseId],
    );
    expect(splits.length).toBe(0);

    const [sched] = await pool.query<RowDataPacket[]>(
      `SELECT case_id FROM case_round_schedules WHERE case_id = ?`,
      [caseId],
    );
    expect(sched.length).toBe(0);

    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM client_task_completions WHERE case_id = ?`,
      [caseId],
    );
    expect(tasks.length).toBe(0);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(clients[0].status).toBe("prospect");
  });

  it("blocks POST /admin/cases/:id/stage leaving prospect", async () => {
    const clientId = await createProspect("case-stage-block");
    const created = await createProspectCase(clientId);
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "docs_ready" })
      .expect(409);
  });

  it("blocks POST /admin/clients/:id/stage for prospects (convert bypass)", async () => {
    const clientId = await createProspect("client-stage-block");
    await createProspectCase(clientId).then((r) => {
      expect(r.status).toBe(201);
      caseIds.push(Number(r.body.case.id));
    });

    const res = await request(app)
      .post(`/api/admin/clients/${clientId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "new_client" })
      .expect(409);
    expect(String(res.body.error)).toMatch(/convert/i);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(clients[0].status).toBe("prospect");
    expect(clients[0].pipeline_stage).toBe("prospect");
  });

  it("convert reuses prospect case, sets pipeline_stage_changed_at, second convert 409", async () => {
    const clientId = await createProspect("reuse-ts");
    const created = await createProspectCase(clientId);
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    await pool.query(
      `UPDATE credit_repair_cases SET pipeline_stage_changed_at = NULL WHERE id = ?`,
      [caseId],
    );

    const conv = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: `convert ${RUN_ID}` })
      .expect(200);

    expect(Number(conv.body.case.id)).toBe(caseId);

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage, pipeline_stage_changed_at FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("new_client");
    expect(cases[0].pipeline_stage_changed_at).toBeTruthy();

    await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(409);
  }, 45_000);

  it("converts a stuck active lead with no case", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES (?, 'Stuck', ?, '5550108888', 'active', 'prospect', 'en')`,
      [`${RUN_ID}-stuck-active@example.test`, RUN_ID],
    );
    const clientId = Number(ins.insertId);
    clientIds.push(clientId);

    const conv = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: `stuck ${RUN_ID}` })
      .expect(200);

    const caseId = Number(conv.body.case.id);
    expect(caseId).toBeGreaterThan(0);
    caseIds.push(caseId);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    expect(rows[0].status).toBe("onboarding");
    expect(rows[0].pipeline_stage).toBe("new_client");
  }, 45_000);

  it("convert cancels duplicate allow_duplicate prospect-stage cases", async () => {
    const clientId = await createProspect("dup-cancel");
    const first = await createProspectCase(clientId);
    expect(first.status).toBe(201);
    const caseA = Number(first.body.case.id);
    caseIds.push(caseA);

    const second = await createProspectCase(clientId, {
      allow_duplicate: true,
      notes: `dup ${RUN_ID}`,
    });
    expect(second.status).toBe(201);
    const caseB = Number(second.body.case.id);
    caseIds.push(caseB);
    expect(caseB).not.toBe(caseA);

    const conv = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "promote latest" })
      .expect(200);

    const kept = Number(conv.body.case.id);
    expect([caseA, caseB]).toContain(kept);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, pipeline_stage FROM credit_repair_cases WHERE id IN (?, ?)`,
      [caseA, caseB],
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r.id), r]));
    expect(byId[kept].status).toBe("active");
    expect(byId[kept].pipeline_stage).toBe("new_client");
    const other = kept === caseA ? caseB : caseA;
    expect(byId[other].status).toBe("cancelled");
  }, 45_000);

  it("payment success promotes existing prospect-stage case onto the board", async () => {
    const {
      __testMarkPaymentSucceeded,
      __testClearEmailDryRuns,
      __testGetEmailDryRuns,
    } = await import("./index");
    const clientId = await createProspect("pay-promote");
    const created = await createProspectCase(clientId);
    expect(created.status).toBe(201);
    const caseId = Number(created.body.case.id);
    caseIds.push(caseId);

    const txnId = `txn_edge_${RUN_ID}_${clientId}`;
    await pool.query(
      `INSERT INTO payments (client_id, amount_cents, status, provider, provider_transaction_id)
       VALUES (?, 100, 'pending', 'manual', ?)`,
      [clientId, txnId],
    );

    // Shared TiDB: prefs suite mutes ephemeral *@example.test agents; other
    // suites may mute real staff. Reset + exclude fixtures so fan-out matches
    // teamAdminNotifyIntegration (see resetTeamAdminNotifyPrefs).
    await pool.query(
      `UPDATE admins SET notification_prefs_json = NULL
       WHERE status = 'active'
         AND role IN ('super_admin','admin','agent')
         AND email IS NOT NULL AND TRIM(email) <> ''
         AND email NOT LIKE '%@example.test'`,
    );
    const [teamAdmins] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM admins
       WHERE status = 'active'
         AND role IN ('super_admin', 'admin', 'agent')
         AND email IS NOT NULL AND TRIM(email) <> ''
         AND email NOT LIKE '%@example.test'`,
    );
    expect(teamAdmins.length).toBeGreaterThan(0);

    __testClearEmailDryRuns();
    await __testMarkPaymentSucceeded(clientId, txnId);

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT c.status, c.pipeline_stage AS client_stage, cr.pipeline_stage AS case_stage
       FROM clients c
       JOIN credit_repair_cases cr ON cr.id = ?
       WHERE c.id = ?`,
      [caseId, clientId],
    );
    expect(after[0].status).toBe("onboarding");
    expect(after[0].client_stage).toBe("new_client");
    expect(after[0].case_stage).toBe("new_client");

    const purchaseMails = __testGetEmailDryRuns().filter(
      (e) =>
        e.subject.startsWith("New purchase —") ||
        e.subject.startsWith("Nueva compra —"),
    );
    const purchaseRecipients = new Set(
      purchaseMails.map((e) => String(e.to || "").trim().toLowerCase()),
    );
    for (const a of teamAdmins) {
      expect(
        purchaseRecipients.has(String(a.email).trim().toLowerCase()),
      ).toBe(true);
    }

    // Idempotent: retry must not re-email the team
    __testClearEmailDryRuns();
    await __testMarkPaymentSucceeded(clientId, txnId);
    expect(
      __testGetEmailDryRuns().filter(
        (e) =>
          e.subject.startsWith("New purchase —") ||
          e.subject.startsWith("Nueva compra —"),
      ).length,
    ).toBe(0);

    const pipe = await request(app)
      .get("/api/admin/pipeline")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ search: `${RUN_ID}-pay-promote` })
      .expect(200);

    const inCases = (pipe.body.cases as any[]).some(
      (c) => Number(c.id) === caseId,
    );
    expect(inCases).toBe(true);
    const stillProspect = (pipe.body.prospects as any[]).some(
      (p) => Number(p.id) === clientId,
    );
    expect(stillProspect).toBe(false);
  }, 45_000);

  it("duplicate prospect case without allow_duplicate returns 409", async () => {
    const clientId = await createProspect("no-dup");
    const first = await createProspectCase(clientId);
    expect(first.status).toBe(201);
    caseIds.push(Number(first.body.case.id));

    const second = await createProspectCase(clientId);
    expect(second.status).toBe(409);
  });
});
