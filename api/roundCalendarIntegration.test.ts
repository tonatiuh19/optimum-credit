/**
 * Round calendar — save/send/recipients/SEQUENCE/calendar/dashboard/create-client.
 * Requires DB_HOST + JWT_SECRET. Emails are dry-run under VITEST=true.
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
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  createServer,
  createSession,
} from "./index";
import { cleanupIntegrationTestClients } from "./testDbCleanup";

const RUN_ID = `rnd-cal-${Date.now()}`;
const CLIENT_EMAIL = `client-${RUN_ID}@example.test`;
const REFERRER_EMAIL = `ref-${RUN_ID}@example.test`;
const INACTIVE_REF_EMAIL = `inactive-ref-${RUN_ID}@example.test`;
const CREATE_CLIENT_EMAIL = `create-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminEmail = "";
let adminToken = "";
let clientId = 0;
let caseId = 0;
let referrerId = 0;
let inactiveReferrerId = 0;
let createdClientId = 0;
let createdCaseId = 0;

function ymdOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DATES = {
  round_1_date: ymdOffset(3),
  round_2_date: ymdOffset(10),
  round_3_date: ymdOffset(17),
  round_4_date: ymdOffset(40),
  round_5_date: ymdOffset(75),
};

async function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    timezone: "+00:00",
    connectionLimit: 3,
  });
}

describe("round calendar — HTTP integration", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for tests");
    adminId = Number(admins[0].id);
    adminEmail = String(admins[0].email).toLowerCase();
    await pool.query(
      `UPDATE admins SET preferred_language = 'en', status = 'active' WHERE id = ?`,
      [adminId],
    );
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-round-calendar",
    );

    const [refIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO referrers
         (category, first_name, last_name, email, preferred_language, status)
       VALUES ('realtor_broker', 'Ref', ?, ?, 'en', 'active')`,
      [RUN_ID, REFERRER_EMAIL],
    );
    referrerId = refIns.insertId;

    const [inactiveIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO referrers
         (category, first_name, last_name, email, preferred_language, status)
       VALUES ('realtor_broker', 'Inactive', ?, ?, 'en', 'inactive')`,
      [`${RUN_ID}-x`, INACTIVE_REF_EMAIL],
    );
    inactiveReferrerId = inactiveIns.insertId;

    const [cliIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage,
          assigned_admin_id, referral_category, referrer_id)
       VALUES (?, 'Round', ?, 'en', 'onboarding', 'new_client', ?, 'realtor_broker', ?)`,
      [CLIENT_EMAIL, RUN_ID, adminId, referrerId],
    );
    clientId = cliIns.insertId;

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases
         (client_id, case_number, pipeline_stage, status)
       VALUES (?, ?, 'new_client', 'active')`,
      [clientId, `CR-RC${String(clientId).slice(-4)}`],
    );
    caseId = caseIns.insertId;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-${String(caseId).padStart(5, "0")}`, caseId],
    );
  }, 90_000);

  afterAll(async () => {
    const caseIds = [caseId, createdCaseId].filter(Boolean);
    for (const id of caseIds) {
      await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM client_task_completions WHERE case_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id]);
    }
    for (const id of [clientId, createdClientId].filter(Boolean)) {
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    for (const id of [referrerId, inactiveReferrerId].filter(Boolean)) {
      await pool.query(`DELETE FROM referrers WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId, createdClientId],
    });
    await pool?.end();
  }, 90_000);

  it("rejects unauthenticated schedule access", async () => {
    await request(app).get(`/api/admin/cases/${caseId}/round-schedule`).expect(401);
    await request(app)
      .put(`/api/admin/cases/${caseId}/round-schedule`)
      .send(DATES)
      .expect(401);
  });

  it("rejects invalid and out-of-order dates", async () => {
    const bad = await request(app)
      .put(`/api/admin/cases/${caseId}/round-schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...DATES, round_2_date: "not-a-date" });
    expect(bad.status).toBe(400);

    const order = await request(app)
      .put(`/api/admin/cases/${caseId}/round-schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...DATES,
        round_3_date: DATES.round_1_date,
        round_2_date: ymdOffset(50),
      });
    expect(order.status).toBe(400);
    expect(String(order.body.error || "")).toMatch(/non-decreasing/i);
  }, 20_000);

  it("saves without send, then sends ICS to client+referrer+admin with SEQUENCE bump", async () => {
    __testClearEmailDryRuns();
    const save = await request(app)
      .put(`/api/admin/cases/${caseId}/round-schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...DATES, interval_days: 35, send_calendar: false });
    expect(save.status).toBe(200);
    expect(save.body.schedule?.round_1_date).toBe(DATES.round_1_date);
    expect(save.body.schedule?.calendar_send_count).toBe(0);
    expect(save.body.sent_to).toEqual([]);
    expect(
      __testGetEmailDryRuns().filter((e) => e.hasCalendarAttachment),
    ).toHaveLength(0);

    const get = await request(app)
      .get(`/api/admin/cases/${caseId}/round-schedule`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.schedule.round_5_date).toBe(DATES.round_5_date);

    __testClearEmailDryRuns();
    const send1 = await request(app)
      .post(`/api/admin/cases/${caseId}/round-schedule/send`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(send1.status).toBe(200);
    const sent1: string[] = send1.body.sent_to ?? [];
    expect(sent1).toEqual(
      expect.arrayContaining([
        CLIENT_EMAIL.toLowerCase(),
        REFERRER_EMAIL.toLowerCase(),
        adminEmail,
      ]),
    );
    expect(sent1).not.toContain(INACTIVE_REF_EMAIL.toLowerCase());

    const dry1 = __testGetEmailDryRuns().filter((e) => e.hasCalendarAttachment);
    expect(dry1.length).toBe(sent1.length);
    expect(dry1.map((e) => e.icsSequence)).toEqual(
      Array(dry1.length).fill(0),
    );

    const [rows1] = await pool.query<RowDataPacket[]>(
      `SELECT calendar_send_count FROM case_round_schedules WHERE case_id = ?`,
      [caseId],
    );
    expect(Number(rows1[0].calendar_send_count)).toBe(1);

    // Inactive referrer must be skipped
    await pool.query(`UPDATE clients SET referrer_id = ? WHERE id = ?`, [
      inactiveReferrerId,
      clientId,
    ]);
    __testClearEmailDryRuns();
    const send2 = await request(app)
      .post(`/api/admin/cases/${caseId}/round-schedule/send`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(send2.status).toBe(200);
    const sent2: string[] = send2.body.sent_to ?? [];
    expect(sent2).not.toContain(INACTIVE_REF_EMAIL.toLowerCase());
    expect(sent2).toEqual(
      expect.arrayContaining([CLIENT_EMAIL.toLowerCase(), adminEmail]),
    );

    const dry2 = __testGetEmailDryRuns().filter((e) => e.hasCalendarAttachment);
    expect(dry2.length).toBe(sent2.length);
    expect(dry2.map((e) => e.icsSequence)).toEqual(
      Array(dry2.length).fill(1),
    );

    const [rows2] = await pool.query<RowDataPacket[]>(
      `SELECT calendar_send_count FROM case_round_schedules WHERE case_id = ?`,
      [caseId],
    );
    expect(Number(rows2[0].calendar_send_count)).toBe(2);

    await pool.query(`UPDATE clients SET referrer_id = ? WHERE id = ?`, [
      referrerId,
      clientId,
    ]);
  }, 60_000);

  it("exposes round_events on calendar and upcoming_rounds on dashboard", async () => {
    const from = ymdOffset(0);
    const to = ymdOffset(20);
    const cal = await request(app)
      .get(`/api/admin/calendar`)
      .query({ from, to })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cal.status).toBe(200);
    expect(Array.isArray(cal.body.round_events)).toBe(true);
    const hit = (cal.body.round_events as any[]).filter(
      (e) => e.case_id === caseId,
    );
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(hit.some((e) => e.round_number === 1)).toBe(true);

    const dash = await request(app)
      .get(`/api/admin/dashboard`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(dash.status).toBe(200);
    expect(Array.isArray(dash.body.upcoming_rounds)).toBe(true);
    expect(
      (dash.body.upcoming_rounds as any[]).some((r) => r.case_id === caseId),
    ).toBe(true);
  }, 30_000);

  it("excludes cancelled cases from calendar and dashboard", async () => {
    await pool.query(
      `UPDATE credit_repair_cases SET status = 'cancelled' WHERE id = ?`,
      [caseId],
    );
    const from = ymdOffset(0);
    const to = ymdOffset(20);
    const cal = await request(app)
      .get(`/api/admin/calendar`)
      .query({ from, to })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      (cal.body.round_events as any[]).some((e) => e.case_id === caseId),
    ).toBe(false);

    const dash = await request(app)
      .get(`/api/admin/dashboard`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      (dash.body.upcoming_rounds as any[]).some((r) => r.case_id === caseId),
    ).toBe(false);

    await pool.query(
      `UPDATE credit_repair_cases SET status = 'active' WHERE id = ?`,
      [caseId],
    );
  }, 30_000);

  it("creates client + case + round schedule via POST /admin/clients", async () => {
    __testClearEmailDryRuns();
    const res = await request(app)
      .post(`/api/admin/clients`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Create",
        last_name: RUN_ID,
        email: CREATE_CLIENT_EMAIL,
        preferred_language: "en",
        status: "onboarding",
        create_case: true,
        round_schedule: {
          ...DATES,
          interval_days: 35,
          send_calendar: true,
        },
      });
    expect(res.status).toBe(201);
    createdClientId = Number(res.body.client?.id);
    createdCaseId = Number(res.body.case?.id);
    expect(createdClientId).toBeGreaterThan(0);
    expect(createdCaseId).toBeGreaterThan(0);
    expect(res.body.round_calendar?.saved).toBe(true);
    expect(res.body.round_calendar?.sent_to?.length).toBeGreaterThanOrEqual(1);

    const [sched] = await pool.query<RowDataPacket[]>(
      `SELECT calendar_send_count FROM case_round_schedules WHERE case_id = ?`,
      [createdCaseId],
    );
    expect(sched[0]).toBeTruthy();
    expect(Number(sched[0].calendar_send_count)).toBe(1);

    const dry = __testGetEmailDryRuns().filter((e) => e.hasCalendarAttachment);
    expect(dry.length).toBeGreaterThanOrEqual(1);
    expect(dry.every((e) => e.icsSequence === 0)).toBe(true);
  }, 60_000);
});
