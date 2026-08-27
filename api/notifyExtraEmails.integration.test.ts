/**
 * Settings → Team notification emails (non-admin recipients).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  createIntegrationTestPool,
  uniqueTestE164,
  withDbRetry,
  cleanupIntegrationTestClients,
} from "./testDbCleanup";
import {
  createServer,
  createSession,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
} from "./index";

const RUN_ID = `xemail-${Date.now()}`;
const SUPER_EMAIL = `xemail-sa-${RUN_ID}@example.test`;
const AGENT_EMAIL = `xemail-agent-${RUN_ID}@example.test`;
const EXTRA_EMAIL = `shared-inbox-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let superId = 0;
let agentId = 0;
let superToken = "";
let agentToken = "";
let phoneNumberId = 0;
let clientId = 0;
let extraEmailId = 0;

describe("admin notify extra emails", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    await withDbRetry(async () => {
      const [sIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admins
           (email, first_name, last_name, role, status, preferred_language)
         VALUES (?, 'XEmail', 'Super', 'super_admin', 'active', 'en')`,
        [SUPER_EMAIL],
      );
      superId = Number(sIns.insertId);
      superToken = await createSession(
        "admin",
        superId,
        SUPER_EMAIL,
        "127.0.0.1",
        "vitest-xemail",
      );

      const [aIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admins
           (email, first_name, last_name, role, status, preferred_language)
         VALUES (?, 'XEmail', 'Agent', 'agent', 'active', 'en')`,
        [AGENT_EMAIL],
      );
      agentId = Number(aIns.insertId);
      agentToken = await createSession(
        "admin",
        agentId,
        AGENT_EMAIL,
        "127.0.0.1",
        "vitest-xemail-agent",
      );

      const [pIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admin_phone_numbers
           (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
         VALUES (?, 'Vitest XEmail OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
        [uniqueTestE164(`${RUN_ID}-ofg`), agentId],
      );
      phoneNumberId = Number(pIns.insertId);

      const [cIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients
           (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
         VALUES ('XEmail', 'Client', ?, '+15559876099', 'prospect', 'prospect', 'en')`,
        [`xemail-client-${RUN_ID}@example.test`],
      );
      clientId = Number(cIns.insertId);
    });
  }, 90_000);

  afterAll(async () => {
    try {
      if (extraEmailId) {
        await pool.query(`DELETE FROM admin_notify_extra_emails WHERE id = ?`, [
          extraEmailId,
        ]);
      }
      await pool.query(`DELETE FROM admin_notify_extra_emails WHERE email = ?`, [
        EXTRA_EMAIL,
      ]);
      await pool.query(
        `DELETE FROM admin_notify_extra_emails WHERE email LIKE ?`,
        [`%${RUN_ID}%`],
      );
      if (clientId) {
        await pool.query(
          `DELETE FROM conversation_messages WHERE conversation_id IN
            (SELECT id FROM (SELECT id FROM conversations WHERE client_id = ?) x)`,
          [clientId],
        );
        await pool.query(`DELETE FROM conversations WHERE client_id = ?`, [
          clientId,
        ]);
      }
      if (phoneNumberId) {
        await pool.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [
          phoneNumberId,
        ]);
      }
      for (const id of [agentId, superId].filter(Boolean)) {
        await pool.query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
          id,
        ]);
        await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [id]);
        await pool.query(`DELETE FROM admins WHERE id = ?`, [id]);
      }
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: clientId ? [clientId] : [],
      });
    } catch (err) {
      console.error("[notifyExtraEmails] cleanup failed:", err);
    } finally {
      await pool.end().catch(() => {});
    }
  });

  it("lists staff team and extras together", async () => {
    const res = await request(app)
      .get("/api/admin/notify-recipients")
      .set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.staff)).toBe(true);
    expect(Array.isArray(res.body.extras)).toBe(true);
    const agent = res.body.staff.find((s: any) => s.id === agentId);
    expect(agent).toBeTruthy();
    expect(agent.email).toBe(AGENT_EMAIL);
    expect(agent.prefs?.email).toBeTruthy();
  });

  it("updates staff channel masters as super admin", async () => {
    const off = await request(app)
      .put(`/api/admin/admins/${agentId}/notification-prefs`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ channel_masters: { email: false } });
    expect(off.status).toBe(200);
    expect(off.body.staff.prefs.email.purchase_enrollment).toBe(false);
    expect(off.body.staff.prefs.email.inbound_sms).toBe(false);

    const on = await request(app)
      .put(`/api/admin/admins/${agentId}/notification-prefs`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ channel_masters: { email: true } });
    expect(on.status).toBe(200);
    expect(on.body.staff.prefs.email.purchase_enrollment).toBe(true);

    const denied = await request(app)
      .put(`/api/admin/admins/${agentId}/notification-prefs`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ channel_masters: { email: false } });
    expect(denied.status).toBe(403);
  });

  it("restricts CRUD to super admins", async () => {
    const denied = await request(app)
      .get("/api/admin/notify-extra-emails")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(denied.status).toBe(403);

    const list = await request(app)
      .get("/api/admin/notify-extra-emails")
      .set("Authorization", `Bearer ${superToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.emails)).toBe(true);
  });

  it("filters extra emails by selected alert types", async () => {
    const add = await request(app)
      .post("/api/admin/notify-extra-emails")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        email: EXTRA_EMAIL,
        label: "Shared inbox",
        events: ["purchase_enrollment"],
      });
    expect(add.status).toBe(200);
    extraEmailId = Number(add.body.email.id);
    expect(add.body.email.events).toEqual(["purchase_enrollment"]);

    __testClearEmailDryRuns();
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const sid = `SMxemail${Date.now()}`;

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+15559876099",
        To: to,
        Body: "Should not email extras (inbound_sms filtered out)",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const dry = __testGetEmailDryRuns();
    const toExtra = dry.filter(
      (d) => String(d.to || "").toLowerCase() === EXTRA_EMAIL,
    );
    expect(toExtra.length).toBe(0);

    // Re-enable all events (null) and confirm inbound SMS emails extras
    const all = await request(app)
      .patch(`/api/admin/notify-extra-emails/${extraEmailId}`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ events: null });
    expect(all.status).toBe(200);
    expect(all.body.email.events).toBeNull();

    __testClearEmailDryRuns();
    const sid2 = `SMxemail2${Date.now()}`;
    const wh2 = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+15559876099",
        To: to,
        Body: "Notify extras please",
        MessageSid: sid2,
      });
    expect(wh2.status).toBe(200);
    const dry2 = __testGetEmailDryRuns();
    expect(
      dry2.filter((d) => String(d.to || "").toLowerCase() === EXTRA_EMAIL)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("adds, pauses, and removes an extra email", async () => {
    if (!extraEmailId) {
      const add = await request(app)
        .post("/api/admin/notify-extra-emails")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ email: EXTRA_EMAIL, label: "Shared inbox" });
      expect(add.status).toBe(200);
      extraEmailId = Number(add.body.email.id);
    }

    const pause = await request(app)
      .patch(`/api/admin/notify-extra-emails/${extraEmailId}`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ is_active: false });
    expect(pause.status).toBe(200);
    expect(pause.body.email.is_active).toBe(false);

    const resume = await request(app)
      .patch(`/api/admin/notify-extra-emails/${extraEmailId}`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ is_active: true });
    expect(resume.status).toBe(200);
    expect(resume.body.email.is_active).toBe(true);
  });

  it("emails active extras on inbound SMS (dry-run)", async () => {
    __testClearEmailDryRuns();
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const sid = `SMxemail3${Date.now()}`;

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+15559876099",
        To: to,
        Body: "Notify extras please",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const dry = __testGetEmailDryRuns();
    const toExtra = dry.filter(
      (d) => String(d.to || "").toLowerCase() === EXTRA_EMAIL,
    );
    expect(toExtra.length).toBeGreaterThanOrEqual(1);
    expect(String(toExtra[0].subject || "")).toMatch(/SMS/i);
  });

  it("deletes the extra email", async () => {
    const del = await request(app)
      .delete(`/api/admin/notify-extra-emails/${extraEmailId}`)
      .set("Authorization", `Bearer ${superToken}`);
    expect(del.status).toBe(200);
    extraEmailId = 0;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admin_notify_extra_emails WHERE email = ?`,
      [EXTRA_EMAIL],
    );
    expect(rows.length).toBe(0);
  });
});
