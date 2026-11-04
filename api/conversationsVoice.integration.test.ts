/**
 * Voice / Twilio softphone — access, settings, dial-status missed notify,
 * inbound TwiML (assigned-admin ring), lookup-contact.
 */
import "dotenv/config";
import {
  afterAll,
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
import { createServer, createSession } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `voice-${Date.now()}`;
const AGENT_EMAIL = `voice-agent-${RUN_ID}@example.test`;
const OTHER_EMAIL = `voice-other-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let otherId = 0;
let agentToken = "";
let otherToken = "";
let phoneNumberId = 0;
let clientId = 0;
const seededClientIds: number[] = [];

describe("conversations voice", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [aIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language, phone,
          voice_available, call_forwarding_enabled)
       VALUES (?, 'Voice', 'Agent', 'agent', 'active', 'en', '+15551234099', 0, 0)`,
      [AGENT_EMAIL],
    );
    agentId = Number(aIns.insertId);
    agentToken = await createSession(
      "admin",
      agentId,
      AGENT_EMAIL,
      "127.0.0.1",
      "vitest",
    );

    const [oIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Voice', 'Other', 'agent', 'active', 'en')`,
      [OTHER_EMAIL],
    );
    otherId = Number(oIns.insertId);
    otherToken = await createSession(
      "admin",
      otherId,
      OTHER_EMAIL,
      "127.0.0.1",
      "vitest",
    );

    const [pIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Voice Suite OFG', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [`+1765${String(Date.now()).slice(-7)}`, agentId],
    );
    phoneNumberId = Number(pIns.insertId);

    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Voice', 'Client', ?, '+17659876099', 'prospect', 'prospect', 'en')`,
      [`voice-client-${RUN_ID}@example.test`],
    );
    clientId = Number(cIns.insertId);
    seededClientIds.push(clientId);
  }, 60_000);

  afterAll(async () => {
    // Scope cleanup to this suite's OFG line so parallel hub tests are not wiped.
    if (phoneNumberId) {
      await pool
        .query(
          `DELETE FROM conversations WHERE ofg_number_id = ? OR unknown_contact_id IN (
             SELECT id FROM (
               SELECT id FROM conversation_unknown_contacts WHERE ofg_number_id = ?
             ) t
           )`,
          [phoneNumberId, phoneNumberId],
        )
        .catch(() => {});
      await pool
        .query(
          `DELETE FROM conversation_unknown_contacts WHERE ofg_number_id = ?`,
          [phoneNumberId],
        )
        .catch(() => {});
      await pool
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId])
        .catch(() => {});
    }
    if (seededClientIds.length) {
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: seededClientIds,
      });
    }
    for (const id of [agentId, otherId].filter(Boolean)) {
      await pool
        .query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [id])
        .catch(() => {});
      await pool
        .query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [id])
        .catch(() => {});
      await pool.query(`DELETE FROM admins WHERE id = ?`, [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it("rejects voice token without assigned OFG number", async () => {
    const res = await request(app)
      .post("/api/voice/token")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("returns voice token or Twilio-not-configured for numbered staff", async () => {
    const res = await request(app)
      .post("/api/voice/token")
      .set("Authorization", `Bearer ${agentToken}`);
    // Dry-run / missing TwiML keys → 503; live Twilio → 200
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body.token).toBe("string");
      expect(res.body.token.length).toBeGreaterThan(20);
    }
  });

  it("updates availability and call-forwarding settings", async () => {
    const avail = await request(app)
      .post("/api/voice/availability")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ available: true });
    expect(avail.status).toBe(200);
    expect(avail.body.available).toBe(true);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT voice_available FROM admins WHERE id = ?`,
      [agentId],
    );
    expect(Number(rows[0].voice_available)).toBe(1);

    const fwd = await request(app)
      .put("/api/voice/call-forwarding")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ enabled: true, phone: "+17651234999" });
    expect(fwd.status).toBe(200);
    expect(fwd.body.call_forwarding_enabled).toBe(true);

    const get = await request(app)
      .get("/api/voice/call-forwarding")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(get.status).toBe(200);
    expect(get.body.call_forwarding_enabled).toBe(true);
    expect(String(get.body.call_forwarding_phone || "")).toContain("17651234999");
  });

  it("loads voicemail settings with has_personal_line for OFG assignee", async () => {
    const res = await request(app)
      .get("/api/voice/voicemail-settings")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.admin.has_personal_line).toBe(true);
    expect(res.body.tenant).toBeTruthy();
  });

  it("lookup-contact resolves CRM client by phone", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/lookup-contact")
      .query({ phone: "+17659876099" })
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.client_id).toBe(clientId);
  });

  it("logs outbound call idempotently by CallSid", async () => {
    const sid = `CAvoice${Date.now()}`;
    const first = await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 12,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const second = await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 12,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(second.status).toBe(200);

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM conversation_messages
       WHERE provider_message_id = ? AND channel = 'call'`,
      [sid],
    );
    expect(Number(count[0].c)).toBe(1);
  });

  it("recording-status attaches mp3 URL by CallSid (Dial parent)", async () => {
    const sid = `CArecstat${Date.now()}`;
    const log = await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 28,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(log.status).toBe(200);

    const recUrl = `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE${Date.now()}`;
    const cb = await request(app)
      .post("/api/voice/recording-status")
      .type("form")
      .send({
        CallSid: sid,
        RecordingUrl: recUrl,
        RecordingDuration: "28",
        RecordingStatus: "completed",
      });
    expect(cb.status).toBe(204);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT recording_url, call_duration_sec FROM conversation_messages
       WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
      [sid],
    );
    expect(String(rows[0]?.recording_url || "")).toBe(`${recUrl}.mp3`);
    expect(Number(rows[0]?.call_duration_sec)).toBe(28);
  });

  it("recording-status before voice/log buffers URL until CallSid is logged", async () => {
    const sid = `CArecbuf${Date.now()}`;
    const recUrl = `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE${Date.now()}`;
    const cb = await request(app)
      .post("/api/voice/recording-status")
      .type("form")
      .send({
        CallSid: sid,
        RecordingUrl: recUrl,
        RecordingDuration: "19",
        RecordingStatus: "completed",
      });
    expect(cb.status).toBe(204);

    const log = await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 19,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(log.status).toBe(200);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT recording_url, call_duration_sec FROM conversation_messages
       WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
      [sid],
    );
    expect(String(rows[0]?.recording_url || "")).toBe(`${recUrl}.mp3`);
    expect(Number(rows[0]?.call_duration_sec)).toBe(19);
  });

  it("inbound voice TwiML rings assigned admin client identity", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    // Signature validation skipped when APP_URL unset or VITEST
    const res = await request(app)
      .post("/api/voice/incoming")
      .type("form")
      .send({
        From: "+17651112222",
        To: to,
        Called: to,
        CallSid: `CAin${Date.now()}`,
        Direction: "inbound",
      });
    expect(res.status).toBe(200);
    const xml = String(res.text || "");
    expect(xml).toContain("<Response>");
    expect(xml).toContain(`admin_${agentId}`);
  }, 60_000);

  it("inbound with forwarding rings cell only when softphone offline", async () => {
    const cell = "+17651234999";
    await pool.query(
      `UPDATE admins
       SET voice_available = 0, call_forwarding_enabled = 1, call_forwarding_phone = ?
       WHERE id = ?`,
      [cell, agentId],
    );
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const res = await request(app)
      .post("/api/voice/incoming")
      .type("form")
      .send({
        From: "+17651112233",
        To: to,
        Called: to,
        CallSid: `CAfwd${Date.now()}`,
        Direction: "inbound",
      });
    expect(res.status).toBe(200);
    const xml = String(res.text || "");
    expect(xml).toContain(cell);
    expect(xml).toContain("call-screen");
    expect(xml).toContain(`callerId="${to}"`);
    expect(xml).not.toContain(`admin_${agentId}`);

    // Self-test from the forward-to cell → cannot ring that handset; fall back to softphone
    const self = await request(app)
      .post("/api/voice/incoming")
      .type("form")
      .send({
        From: cell,
        To: to,
        Called: to,
        CallSid: `CAself${Date.now()}`,
        Direction: "inbound",
      });
    expect(self.status).toBe(200);
    const selfXml = String(self.text || "");
    expect(selfXml).toContain(`admin_${agentId}`);
    expect(selfXml).not.toContain(`>${cell}<`);
  }, 60_000);

  it("dial-status no-answer creates missed_call in-app notification", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const from = `+1765${String(Date.now()).slice(-7)}`;
    const sid = `CAmiss${Date.now()}`;

    const res = await request(app)
      .post("/api/voice/dial-status")
      .type("form")
      .send({
        CallSid: sid,
        DialCallStatus: "no-answer",
        From: from,
        To: to,
        Called: to,
      });
    expect(res.status).toBe(200);
    expect(String(res.text || "")).toContain("<Response>");

    // Allow async notify
    await new Promise((r) => setTimeout(r, 400));

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, event_key, title FROM admin_notifications
       WHERE admin_id = ? AND event_key = 'missed_call'
       ORDER BY id DESC LIMIT 1`,
      [agentId],
    );
    expect(rows[0]).toBeTruthy();
    expect(String(rows[0].title || "")).toMatch(/missed/i);
  });

  it("fix-call-setup returns Twilio status without crashing", async () => {
    const res = await request(app)
      .post("/api/voice/fix-call-setup")
      .set("Authorization", `Bearer ${agentToken}`);
    expect([200, 503, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.voiceUrl || res.body.twimlAppSid).toBeTruthy();
    }
  });

  it("timeline returns call recording_url and call_duration_sec", async () => {
    const sid = `CArec${Date.now()}`;
    const log = await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 45,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(log.status).toBe(200);

    await pool.query(
      `UPDATE conversation_messages
       SET recording_url = ?, call_duration_sec = 45
       WHERE provider_message_id = ? AND channel = 'call'`,
      [`https://api.twilio.com/recordings/${sid}`, sid],
    );

    const timeline = await request(app)
      .get(`/api/admin/conversations/contact/client/${clientId}/timeline`)
      .set("Authorization", `Bearer ${agentToken}`);
    expect(timeline.status).toBe(200);
    const msg = (timeline.body.messages || []).find(
      (m: { provider_message_id?: string }) => m.provider_message_id === sid,
    );
    expect(msg).toBeTruthy();
    expect(msg.channel).toBe("call");
    expect(Number(msg.call_duration_sec)).toBe(45);
    expect(String(msg.recording_url || "")).toContain(sid);
  });

  it("recording proxy forbids staff without OFG assignment to that conversation", async () => {
    const sid = `CAauthz${Date.now()}`;
    await request(app)
      .post("/api/voice/log")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+17659876099",
        duration: 10,
        call_status: "completed",
        call_sid: sid,
        client_id: clientId,
        direction: "outbound",
      });
    await pool.query(
      `UPDATE conversation_messages
       SET recording_url = ?
       WHERE provider_message_id = ? AND channel = 'call'`,
      [`https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/${sid}`, sid],
    );

    // Staff with no OFG line
    const deniedNoLine = await request(app)
      .get(`/api/voice/recording/${sid}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(deniedNoLine.status).toBe(403);

    // Staff with a different OFG line (conversations access, wrong assignment)
    const peerEmail = `voice-peer-${RUN_ID}@example.test`;
    const [peerIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Voice', 'Peer', 'agent', 'active', 'en')`,
      [peerEmail],
    );
    const peerId = Number(peerIns.insertId);
    const peerToken = await createSession(
      "admin",
      peerId,
      peerEmail,
      "127.0.0.1",
      "vitest",
    );
    const [peerPhone] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Vitest Peer OFG', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [`+1765${String(Date.now() + 1).slice(-7)}`, peerId],
    );
    const peerPhoneId = Number(peerPhone.insertId);

    try {
      const deniedWrongLine = await request(app)
        .get(`/api/voice/recording/${sid}`)
        .set("Authorization", `Bearer ${peerToken}`);
      expect(deniedWrongLine.status).toBe(403);

      const allowed = await request(app)
        .get(`/api/voice/recording/${sid}`)
        .set("Authorization", `Bearer ${agentToken}`);
      // Authz passes; Twilio fetch may fail upstream (fake SID / test creds).
      // Upstream 401/403 are mapped to 502 so they are not mistaken for session auth.
      expect([200, 206, 502, 503, 404]).toContain(allowed.status);
      expect(allowed.status).not.toBe(403);
      expect(allowed.status).not.toBe(401);
    } finally {
      await pool
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [peerPhoneId])
        .catch(() => {});
      await pool
        .query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [peerId])
        .catch(() => {});
      await pool.query(`DELETE FROM admins WHERE id = ?`, [peerId]).catch(() => {});
    }
  });

  it("inbound call bumps unknown-contact unread and preview", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const from = `+1765${String(Date.now()).slice(-7)}`;
    const sid = `CAunk${Date.now()}`;

    const res = await request(app)
      .post("/api/voice/incoming")
      .type("form")
      .send({
        From: from,
        To: to,
        Called: to,
        CallSid: sid,
        Direction: "inbound",
      });
    expect(res.status).toBe(200);

    // Async fire-and-forget log — poll briefly for unread bump
    let unread = 0;
    let preview = "";
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const [unk] = await pool.query<RowDataPacket[]>(
        `SELECT unread_count, last_message_preview
         FROM conversation_unknown_contacts
         WHERE phone_e164 = ?
         ORDER BY id DESC LIMIT 1`,
        [from],
      );
      if (unk[0]) {
        unread = Number(unk[0].unread_count || 0);
        preview = String(unk[0].last_message_preview || "");
        if (unread >= 1) break;
      }
    }
    expect(unread).toBeGreaterThanOrEqual(1);
    expect(preview).toMatch(/Incoming call/i);
  });

  it("dial-status before inbound log applies pending provider_status", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const from = `+1765${String(Date.now()).slice(-7)}`;
    const sid = `CArace${Date.now()}`;

    // Dial-status first (message not inserted yet) — should remember pending
    await request(app)
      .post("/api/voice/dial-status")
      .type("form")
      .send({
        CallSid: sid,
        DialCallStatus: "no-answer",
        From: from,
        To: to,
        Called: to,
      });

    // Then incoming inserts with takePendingDialStatus
    await request(app)
      .post("/api/voice/incoming")
      .type("form")
      .send({
        From: from,
        To: to,
        Called: to,
        CallSid: sid,
        Direction: "inbound",
      });

    await new Promise((r) => setTimeout(r, 200));

    let status: string | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT provider_status FROM conversation_messages
         WHERE provider_message_id = ? AND channel = 'call'
         LIMIT 1`,
        [sid],
      );
      if (rows[0]) {
        status = String(rows[0].provider_status);
        break;
      }
    }
    expect(status).toBe("no-answer");
  });

  it("outbound-dial-end writes Twilio's final status + duration over the browser label", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(`SELECT e164 FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId]);
    const to = String(numRows[0].e164);
    const from = `+1765${String(Date.now()).slice(-7)}`;
    const sid = `CAend${Date.now()}`;
    await request(app).post("/api/voice/incoming").type("form").send({ From: from, To: to, Called: to, CallSid: sid, Direction: "inbound" });
    let rowId = 0;
    for (let i = 0; i < 20 && !rowId; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM conversation_messages WHERE provider_message_id = ? AND channel = 'call'`, [sid]);
      rowId = Number(rows[0]?.id || 0);
    }
    expect(rowId).toBeGreaterThan(0);
    await pool.query(`UPDATE conversation_messages SET provider_status = 'failed', call_duration_sec = 3 WHERE id = ?`, [rowId]);
    const r = await request(app).post("/api/voice/outbound-dial-end").type("form").send({ CallSid: sid, DialCallStatus: "completed", DialCallDuration: "66" });
    expect(r.status).toBe(200);
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT provider_status, call_duration_sec FROM conversation_messages WHERE id = ?`, [rowId]);
    expect(row).toMatchObject({ provider_status: "completed", call_duration_sec: 66 });
    // Non-terminal statuses never overwrite.
    await request(app).post("/api/voice/outbound-dial-end").type("form").send({ CallSid: sid, DialCallStatus: "in-progress" });
    const [[again]] = await pool.query<RowDataPacket[]>(`SELECT provider_status FROM conversation_messages WHERE id = ?`, [rowId]);
    expect(again.provider_status).toBe("completed");
  });
});
