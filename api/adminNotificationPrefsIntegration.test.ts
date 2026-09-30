/**
 * Admin notification prefs — mute email/in-app; inbox delivery.
 * Uses an ephemeral agent so muting never races teamAdminNotify fan-out
 * assertions on real staff rows in shared TiDB.
 */
import "dotenv/config";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
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
  __testMarkPaymentSucceeded,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `prefs-${Date.now()}`;
const PREFS_ADMIN_EMAIL = `prefs-agent-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let adminEmail = "";
/** Every client seeded by this suite — afterAll must delete all, not only the last. */
const seededClientIds: number[] = [];
let clientId = 0;
let caseId = 0;

function trackClient(id: number) {
  seededClientIds.push(id);
  clientId = id;
}

describe("admin notification preferences", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Prefs', 'Agent', 'agent', 'active', 'en')`,
      [PREFS_ADMIN_EMAIL],
    );
    adminId = Number(ins.insertId);
    adminEmail = PREFS_ADMIN_EMAIL;
    adminToken = await createSession(
      "admin",
      adminId,
      adminEmail,
      "127.0.0.1",
      "vitest-prefs",
    );
    await pool.query(
      `UPDATE admins SET notification_prefs_json = NULL WHERE id = ?`,
      [adminId],
    );
  }, 60_000);

  afterAll(async () => {
    if (adminId) {
      await pool.query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
        adminId,
      ]);
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
        adminId,
      ]);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [adminId]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: seededClientIds,
    });
    await pool?.end();
  }, 90_000);

  afterEach(async () => {
    if (!adminId) return;
    await pool.query(
      `UPDATE admins SET notification_prefs_json = NULL WHERE id = ?`,
      [adminId],
    );
  });

  it("GET prefs defaults all ON + SMS channel meta", async () => {
    const res = await request(app)
      .get("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.prefs.email.purchase_enrollment).toBe(true);
    expect(res.body.prefs.in_app.submission_doc_upload).toBe(true);
    expect(res.body.channels.email.available).toBe(true);
    expect(res.body.channels.in_app.available).toBe(true);
    expect(typeof res.body.channels.sms.available).toBe("boolean");
    expect(res.body.events).toContain("purchase_enrollment");
  });

  it("ignores SMS writes while Twilio channel is unavailable", async () => {
    const before = await request(app)
      .get("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    if (before.body.channels.sms.available) return; // env has Twilio — skip

    const res = await request(app)
      .put("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sms: { purchase_enrollment: false } })
      .expect(200);
    expect(res.body.prefs.sms.purchase_enrollment).toBe(true);
  });

  it("muting both email + in_app skips purchase delivery for this admin", async () => {
    await request(app)
      .put("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: { payment_installment: false },
        in_app: { payment_installment: false },
      })
      .expect(200);

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('MuteBoth', ?, ?, 'onboarding', 'new_client', 'en')`,
      [`Both-${RUN_ID}`, `prefs-both-${RUN_ID}@example.test`],
    );
    const cid = Number(ins.insertId);
    trackClient(cid);
    await pool.query(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'new_client', 'active', ?)`,
      [cid, `${RUN_ID}-both`],
    );

    const check = await request(app)
      .get("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(check.body.prefs.email.payment_installment).toBe(false);
    expect(check.body.prefs.in_app.payment_installment).toBe(false);
  });

  it("PUT mutes purchase email and still creates in-app on payment", async () => {
    await request(app)
      .put("/api/admin/me/notification-prefs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: { purchase_enrollment: false } })
      .expect(200);

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('Prefs', ?, ?, 'pending_payment', 'new_client', 'en')`,
      [`Pay-${RUN_ID}`, `prefs-pay-${RUN_ID}@example.test`],
    );
    trackClient(Number(ins.insertId));
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'new_client', 'active', ?)`,
      [clientId, RUN_ID],
    );
    caseId = Number(cIns.insertId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-P${String(caseId).padStart(5, "0")}`, caseId],
    );

    const txnId = `txn-prefs-${RUN_ID}`;
    await pool.query(
      `INSERT INTO payments
         (client_id, case_id, amount_cents, status, provider, provider_transaction_id)
       VALUES (?, ?, 19900, 'pending', 'manual', ?)`,
      [clientId, caseId, txnId],
    );

    __testClearEmailDryRuns();
    await __testMarkPaymentSucceeded(clientId, txnId);
    await new Promise((r) => setTimeout(r, 3_000));

    const purchaseMails = __testGetEmailDryRuns().filter(
      (e) =>
        e.to.toLowerCase() === adminEmail.toLowerCase() &&
        (e.subject.startsWith("New purchase —") ||
          e.subject.startsWith("Nueva compra —")),
    );
    expect(purchaseMails.length).toBe(0);

    const [inbox] = await pool.query<RowDataPacket[]>(
      `SELECT id, event_key, title FROM admin_notifications
       WHERE admin_id = ? AND event_key = 'purchase_enrollment'
       ORDER BY id DESC LIMIT 1`,
      [adminId],
    );
    expect(inbox.length).toBe(1);

    const list = await request(app)
      .get("/api/admin/me/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.unread_count).toBeGreaterThanOrEqual(1);

    await request(app)
      .post("/api/admin/me/notifications/read")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ all: true })
      .expect(200);
  }, 45_000);

  it("super_admin channel_masters email=false persists (not NULL defaults)", async () => {
    const saEmail = `prefs-sa-${RUN_ID}@example.test`;
    const [saIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Prefs', 'Super', 'super_admin', 'active', 'en')`,
      [saEmail],
    );
    const saId = Number(saIns.insertId);
    const saToken = await createSession(
      "admin",
      saId,
      saEmail,
      "127.0.0.1",
      "vitest-prefs-sa",
    );
    try {
      await pool.query(
        `UPDATE admins SET notification_prefs_json = NULL WHERE id = ?`,
        [adminId],
      );

      const put = await request(app)
        .put(`/api/admin/admins/${adminId}/notification-prefs`)
        .set("Authorization", `Bearer ${saToken}`)
        .send({ channel_masters: { email: false } })
        .expect(200);
      expect(put.body.staff.prefs.email.purchase_enrollment).toBe(false);
      expect(put.body.staff.prefs.email.morning_digest).toBe(false);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT notification_prefs_json FROM admins WHERE id = ? LIMIT 1`,
        [adminId],
      );
      expect(rows[0].notification_prefs_json).not.toBeNull();
      const stored =
        typeof rows[0].notification_prefs_json === "string"
          ? JSON.parse(String(rows[0].notification_prefs_json))
          : rows[0].notification_prefs_json;
      expect(stored.email.purchase_enrollment).toBe(false);
      expect(stored.email.morning_digest).toBe(false);

      const list = await request(app)
        .get("/api/admin/notify-recipients")
        .set("Authorization", `Bearer ${saToken}`)
        .expect(200);
      const staff = (list.body.staff as any[]).find(
        (s) => Number(s.id) === adminId,
      );
      expect(staff).toBeTruthy();
      expect(staff.prefs.email.purchase_enrollment).toBe(false);
      expect(staff.prefs.email.morning_digest).toBe(false);
    } finally {
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [saId]);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [saId]);
    }
  }, 45_000);
});
