/**
 * Conversations Contact Hub — access gate, unknown queue, assign/link.
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
import { cleanupIntegrationTestClients, createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const RUN_ID = `conv-${Date.now()}`;
const AGENT_EMAIL = `conv-agent-${RUN_ID}@example.test`;
const OTHER_EMAIL = `conv-other-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let otherId = 0;
let agentToken = "";
let otherToken = "";
let phoneNumberId = 0;
let clientId = 0;
const seededClientIds: number[] = [];

describe("conversations contact hub", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [aIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language, phone)
       VALUES (?, 'Conv', 'Agent', 'agent', 'active', 'en', '+15551234001')`,
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
       VALUES (?, 'Conv', 'Other', 'agent', 'active', 'en')`,
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
       VALUES (?, 'Vitest OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [uniqueTestE164(`${RUN_ID}-ofg`), agentId],
    );
    phoneNumberId = Number(pIns.insertId);

    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Conv', 'Client', ?, '+15559876001', 'prospect', 'prospect', 'en')`,
      [`conv-client-${RUN_ID}@example.test`],
    );
    clientId = Number(cIns.insertId);
    seededClientIds.push(clientId);
  }, 60_000);

  afterAll(async () => {
    // Unknown queue + MMS webhook fixtures use +1555… — remove before clients/admins
    await pool
      .query(
        `DELETE FROM conversations WHERE unknown_contact_id IN (
           SELECT id FROM (
             SELECT id FROM conversation_unknown_contacts
             WHERE phone_e164 LIKE '+1555%'
           ) t
         )`,
      )
      .catch(() => {});
    await pool
      .query(
        `DELETE FROM conversation_unknown_contacts WHERE phone_e164 LIKE '+1555%'`,
      )
      .catch(() => {});
    await pool
      .query(`DELETE FROM mms_media WHERE created_by_admin_id IN (?, ?)`, [
        agentId,
        otherId,
      ])
      .catch(() => {});
    if (phoneNumberId) {
      await pool
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId])
        .catch(() => {});
    }
    // Do not DELETE other suites' Vitest OFG rows (voice uses a different friendly_name).
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
      await pool.query(`DELETE FROM admins WHERE id = ?`, [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it("denies Conversations without an assigned OFG number", async () => {
    const res = await request(app)
      .get("/api/admin/conversations")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("conversations_number_required");
  });

  it("reports access enabled for numbered staff", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/access")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(Array.isArray(res.body.numbers)).toBe(true);
    expect(res.body.numbers.length).toBeGreaterThan(0);
  });

  it("returns nav badge unread total", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/badge")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.unread_total).toBe("number");
  });

  it("me includes conversations_enabled for assignee", async () => {
    const res = await request(app)
      .get("/api/auth/admin/me")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.conversations_enabled).toBe(true);
  });

  it("queues unknown inbound via webhook and supports link", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMvitest${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: to,
        Body: "Hello from unknown",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const inbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${agentToken}`);
    expect(inbox.status).toBe(200);
    const unknown = (inbox.body.contacts || []).find(
      (c: any) => c.kind === "unknown" && String(c.phone).includes(unknownPhone.slice(-7)),
    );
    expect(unknown).toBeTruthy();

    const link = await request(app)
      .post(`/api/admin/conversations/unknown/${unknown.contact_id}/link`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ client_id: clientId });
    expect(link.status).toBe(200);
    expect(link.body.client_id).toBe(clientId);

    const timeline = await request(app)
      .get(`/api/admin/conversations/contact/client/${clientId}/timeline`)
      .set("Authorization", `Bearer ${agentToken}`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.messages?.length).toBeGreaterThan(0);
  });

  it("otp-options exposes sms only with personal phone + OFG number + Twilio", async () => {
    const res = await request(app)
      .post("/api/auth/admin/otp-options")
      .send({ email: AGENT_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(true);
    const twilioReady = !!(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    );
    expect(res.body.sms).toBe(twilioReady);

    const noNumber = await request(app)
      .post("/api/auth/admin/otp-options")
      .send({ email: OTHER_EMAIL });
    expect(noNumber.status).toBe(200);
    expect(noNumber.body.sms).toBe(false);
  });

  it("uploads MMS media and serves it publicly; send accepts media_url", async () => {
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await request(app)
      .post("/api/admin/conversations/media/upload")
      .set("Authorization", `Bearer ${agentToken}`)
      .attach("file", png1x1, {
        filename: "dot.png",
        contentType: "image/png",
      });
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/\/api\/conversations\/media\/public\//);
    // Twilio cannot fetch localhost — upload must mint a public host
    expect(String(up.body.url)).toMatch(/^https:\/\//);
    expect(String(up.body.url)).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(up.body.content_type).toBe("image/png");

    const mediaId = String(up.body.url).split("/").pop();
    const pub = await request(app).get(
      `/api/conversations/media/public/${mediaId}`,
    );
    expect(pub.status).toBe(200);
    expect(String(pub.headers["content-type"] || "")).toMatch(/image\/png/);

    // Localhost-shaped URL still accepted — rewritten to public base for Twilio
    const localShaped = `http://localhost:8888/api/conversations/media/public/${mediaId}`;
    const sendLocal = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: "mms rewrite",
        media_url: localShaped,
        media_content_type: "image/png",
        ofg_number_id: phoneNumberId,
      });
    expect(sendLocal.status).toBe(200);
    expect(sendLocal.body.ok).toBe(true);
    const [rewritten] = await pool.query<RowDataPacket[]>(
      `SELECT media_url FROM conversation_messages WHERE id = ? LIMIT 1`,
      [sendLocal.body.message_id],
    );
    expect(String(rewritten[0]?.media_url || "")).toMatch(/^https:\/\//);
    expect(String(rewritten[0]?.media_url || "")).toContain(mediaId);
    expect(String(rewritten[0]?.media_url || "")).not.toMatch(/localhost/);

    const send = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: "",
        media_url: up.body.url,
        media_content_type: "image/png",
        ofg_number_id: phoneNumberId,
      });
    expect(send.status).toBe(200);
    expect(send.body.ok).toBe(true);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT media_url, media_content_type, body FROM conversation_messages
       WHERE id = ? LIMIT 1`,
      [send.body.message_id],
    );
    expect(rows[0]?.media_url).toBe(up.body.url);
    expect(rows[0]?.media_content_type).toBe("image/png");
  });

  it("accepts inbound MMS with empty body via webhook", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMmms${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: to,
        Body: "",
        MessageSid: sid,
        NumMedia: "1",
        MediaUrl0: "https://example.com/not-fetched-in-vitest.png",
        MediaContentType0: "image/png",
      });
    expect(wh.status).toBe(200);

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.media_url, m.media_content_type, m.body
       FROM conversation_messages m
       WHERE m.provider_message_id = ? LIMIT 1`,
      [sid],
    );
    expect(msgs[0]).toBeTruthy();
    expect(msgs[0].media_content_type).toBe("image/png");
    // Without Twilio fetch credentials succeeding, falls back to Twilio URL
    expect(String(msgs[0].media_url || "")).toContain("example.com");
  });

  it("updates provider_status via sms-status webhook", async () => {
    const send = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: "status callback probe",
        ofg_number_id: phoneNumberId,
      });
    expect(send.status).toBe(200);
    expect(send.body.message_id).toBeTruthy();

    const [before] = await pool.query<RowDataPacket[]>(
      `SELECT provider_message_id, provider_status, to_address FROM conversation_messages
       WHERE id = ? LIMIT 1`,
      [send.body.message_id],
    );
    expect(before[0]?.provider_message_id).toMatch(/^dry-run-/);
    expect(before[0]?.provider_status).toBe("queued");
    expect(String(before[0]?.to_address || "")).toMatch(/^\+1/);

    const st = await request(app)
      .post("/api/webhooks/twilio/sms-status")
      .type("form")
      .send({
        MessageSid: String(before[0].provider_message_id),
        MessageStatus: "delivered",
      });
    expect(st.status).toBe(200);

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT provider_status FROM conversation_messages WHERE id = ? LIMIT 1`,
      [send.body.message_id],
    );
    expect(after[0]?.provider_status).toBe("delivered");

    // Regressive callback must not overwrite delivered
    const regress = await request(app)
      .post("/api/webhooks/twilio/sms-status")
      .type("form")
      .send({
        MessageSid: String(before[0].provider_message_id),
        MessageStatus: "queued",
      });
    expect(regress.status).toBe(200);
    const [still] = await pool.query<RowDataPacket[]>(
      `SELECT provider_status FROM conversation_messages WHERE id = ? LIMIT 1`,
      [send.body.message_id],
    );
    expect(still[0]?.provider_status).toBe("delivered");

    // Unknown SID is a no-op 200 (race before INSERT)
    const miss = await request(app)
      .post("/api/webhooks/twilio/sms-status")
      .type("form")
      .send({
        MessageSid: `SMmissing${Date.now()}`,
        MessageStatus: "delivered",
      });
    expect(miss.status).toBe(200);
  });

  it("stores known-client inbound and is idempotent by MessageSid", async () => {
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    // Client phone is E.164; Twilio From may differ in formatting
    const from = "+15559876001";
    const sid = `SMknown${Date.now()}`;

    const wh1 = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: to,
        Body: "Client reply one",
        MessageSid: sid,
      });
    expect(wh1.status).toBe(200);

    const timeline = await request(app)
      .get(`/api/admin/conversations/contact/client/${clientId}/timeline`)
      .set("Authorization", `Bearer ${agentToken}`);
    expect(timeline.status).toBe(200);
    const hit = (timeline.body.messages || []).find(
      (m: any) => m.provider_message_id === sid,
    );
    expect(hit).toBeTruthy();
    expect(hit.direction).toBe("inbound");
    expect(hit.body).toBe("Client reply one");

    const [noteRows] = await pool.query<RowDataPacket[]>(
      `SELECT admin_notes FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    expect(String(noteRows[0]?.admin_notes || "")).toContain("[SMS");
    expect(String(noteRows[0]?.admin_notes || "")).toContain("Received from");
    expect(String(noteRows[0]?.admin_notes || "")).toContain("Client reply one");

    const wh2 = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: to,
        Body: "Client reply one",
        MessageSid: sid,
      });
    expect(wh2.status).toBe(200);

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM conversation_messages WHERE provider_message_id = ?`,
      [sid],
    );
    expect(Number(countRows[0].c)).toBe(1);
  });

  it("matches inbound From to 10-digit client phone and records failed status", async () => {
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Ten', 'Digit', ?, '3235550199', 'prospect', 'prospect', 'en')`,
      [`conv-10digit-${RUN_ID}@example.test`],
    );
    const tenDigitClientId = Number(cIns.insertId);
    seededClientIds.push(tenDigitClientId);

    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);
    const sid = `SM10d${Date.now()}`;

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+13235550199",
        To: to,
        Body: "ten digit match",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.body, c.client_id
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.provider_message_id = ? LIMIT 1`,
      [sid],
    );
    expect(msgs[0]?.client_id).toBe(tenDigitClientId);
    expect(msgs[0]?.body).toBe("ten digit match");

    const send = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: tenDigitClientId,
        channel: "sms",
        body: "will fail status",
        ofg_number_id: phoneNumberId,
      });
    expect(send.status).toBe(200);
    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT provider_message_id FROM conversation_messages WHERE id = ?`,
      [send.body.message_id],
    );
    const fail = await request(app)
      .post("/api/webhooks/twilio/sms-status")
      .type("form")
      .send({
        MessageSid: String(row[0].provider_message_id),
        MessageStatus: "failed",
        ErrorCode: "30003",
        ErrorMessage: "Unreachable destination",
      });
    expect(fail.status).toBe(200);
    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT provider_status, error_message FROM conversation_messages WHERE id = ?`,
      [send.body.message_id],
    );
    expect(after[0]?.provider_status).toBe("failed");
    expect(String(after[0]?.error_message || "")).toContain("30003");
  });

  it("proxies Twilio media only with a valid admin token", async () => {
    const twilioUrl =
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxx/Messages/MMxxxxxxxx/Media/MExxxxxxxx";
    const missing = await request(app)
      .get("/api/conversations/media")
      .query({ url: twilioUrl });
    expect(missing.status).toBe(401);

    const badOrigin = await request(app)
      .get("/api/conversations/media")
      .query({ url: "https://evil.example/x.png", token: agentToken });
    expect(badOrigin.status).toBe(400);
    expect(badOrigin.body.error).toBe("Invalid media URL");

    const okOrigin = await request(app)
      .get("/api/conversations/media")
      .query({ url: twilioUrl, token: agentToken });
    // Upstream fetch may 401/404 from Twilio with a fake path — never open-relay
    expect([200, 401, 404, 503]).toContain(okOrigin.status);
  });

  it("rejects open-relay media_url and empty MMS send", async () => {
    const bad = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: "hi",
        media_url: "https://evil.example/x.png",
        ofg_number_id: phoneNumberId,
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid media_url");

    const empty = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: "   ",
        ofg_number_id: phoneNumberId,
      });
    expect(empty.status).toBe(400);

    const denied = await request(app)
      .post("/api/admin/conversations/media/upload")
      .set("Authorization", `Bearer ${otherToken}`)
      .attach("file", Buffer.from("x"), {
        filename: "x.png",
        contentType: "image/png",
      });
    expect(denied.status).toBe(403);

    const badId = await request(app).get(
      "/api/conversations/media/public/not-a-uuid",
    );
    expect(badId.status).toBe(400);

    const missing = await request(app).get(
      "/api/conversations/media/public/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
  });

  it("scopes unknown contacts to the assigned OFG line owner", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMscope${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: to,
        Body: "scoped unknown",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const agentInbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${agentToken}`);
    const unknown = (agentInbox.body.contacts || []).find(
      (c: any) => c.kind === "unknown",
    );
    expect(unknown).toBeTruthy();
    const unknownId = Number(unknown.contact_id);

    const [pIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Vitest Other OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [`+1555${String(Date.now() + 1).slice(-7)}`, otherId],
    );
    const otherPhoneId = Number(pIns.insertId);

    const otherInbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${otherToken}`);
    expect(otherInbox.status).toBe(200);
    const leaked = (otherInbox.body.contacts || []).find(
      (c: any) => c.kind === "unknown" && c.contact_id === unknownId,
    );
    expect(leaked).toBeFalsy();

    const timeline = await request(app)
      .get(`/api/admin/conversations/contact/unknown/${unknownId}/timeline`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(timeline.status).toBe(404);

    await pool
      .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [otherPhoneId])
      .catch(() => {});
  });

  it("creates inbound_sms bell row and dedupes by provider_message_id", async () => {
    const sid = `SMbell${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    const wh1 = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+15559876001",
        To: to,
        Body: "Bell test inbound",
        MessageSid: sid,
      });
    expect(wh1.status).toBe(200);

    const [rows1] = await pool.query<RowDataPacket[]>(
      `SELECT id, event_key, link_url FROM admin_notifications
       WHERE admin_id = ? AND event_key = 'inbound_sms'
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_message_id')) = ?
       ORDER BY id DESC LIMIT 5`,
      [agentId, sid],
    );
    expect(rows1.length).toBe(1);
    expect(String(rows1[0].link_url || "")).toContain(
      `/admin/conversations?client=${clientId}`,
    );

    const badge = await request(app)
      .get("/api/admin/conversations/badge")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(badge.status).toBe(200);
    expect(badge.body.unread_total).toBeGreaterThan(0);

    const wh2 = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: "+15559876001",
        To: to,
        Body: "Bell test inbound duplicate",
        MessageSid: sid,
      });
    expect(wh2.status).toBe(200);

    const [rows2] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admin_notifications
       WHERE admin_id = ? AND event_key = 'inbound_sms'
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.provider_message_id')) = ?`,
      [agentId, sid],
    );
    expect(rows2.length).toBe(1);
  });

  it("starts cold outbound to a new unknown number", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const start = await request(app)
      .post("/api/admin/conversations/start")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: unknownPhone,
        body: "Cold outbound hello",
        ofg_number_id: phoneNumberId,
      });
    expect(start.status).toBe(200);
    expect(start.body.kind).toBe("unknown");
    expect(start.body.unknown_contact_id).toBeTruthy();
    expect(start.body.message_id).toBeTruthy();
    expect(start.body.unknown_created).toBe(true);

    const inbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${agentToken}`);
    const hit = (inbox.body.contacts || []).find(
      (c: any) =>
        c.kind === "unknown" &&
        c.contact_id === Number(start.body.unknown_contact_id),
    );
    expect(hit).toBeTruthy();
  });

  it("start routes to existing client when phone matches CRM", async () => {
    const start = await request(app)
      .post("/api/admin/conversations/start")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "+15559876001",
        body: "Hello existing client via start",
        ofg_number_id: phoneNumberId,
      });
    expect(start.status).toBe(200);
    expect(start.body.kind).toBe("client");
    expect(start.body.client_id).toBe(clientId);
    expect(start.body.message_id).toBeTruthy();
  });

  it("sends outbound SMS to unknown contact and rejects internal notes", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMout${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: to,
        Body: "Inbound before reply",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const inbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${agentToken}`);
    const unknown = (inbox.body.contacts || []).find(
      (c: any) => c.kind === "unknown" && String(c.phone).includes(unknownPhone.slice(-7)),
    );
    expect(unknown).toBeTruthy();
    const unknownId = Number(unknown.contact_id);

    const send = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        unknown_contact_id: unknownId,
        channel: "sms",
        body: "Staff reply to unknown",
        ofg_number_id: phoneNumberId,
      });
    expect(send.status).toBe(200);
    expect(send.body.ok).toBe(true);
    expect(send.body.unknown_contact_id).toBe(unknownId);

    const note = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        unknown_contact_id: unknownId,
        channel: "internal",
        body: "Should fail",
        is_internal_note: true,
        ofg_number_id: phoneNumberId,
      });
    expect(note.status).toBe(400);
  });

  it("create-prospect from unknown with optional pipeline case", async () => {
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMprosp${Date.now()}`;
    const [numRows] = await pool.query<RowDataPacket[]>(
      `SELECT e164 FROM admin_phone_numbers WHERE id = ?`,
      [phoneNumberId],
    );
    const to = String(numRows[0].e164);

    await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: to,
        Body: "Prospect me",
        MessageSid: sid,
      });

    const inbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Authorization", `Bearer ${agentToken}`);
    const unknown = (inbox.body.contacts || []).find(
      (c: any) => c.kind === "unknown" && String(c.phone).includes(unknownPhone.slice(-7)),
    );
    expect(unknown).toBeTruthy();
    const unknownId = Number(unknown.contact_id);

    const [dupIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Existing', 'Phone', ?, ?, 'prospect', 'prospect', 'en')`,
      [`dup-phone-${RUN_ID}@example.test`, unknownPhone],
    );
    seededClientIds.push(Number(dupIns.insertId));

    const dup = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/create-prospect`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        first_name: "Dup",
        last_name: "Check",
        preferred_language: "en",
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_phone");

    const created = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/create-prospect`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        first_name: "New",
        last_name: "Lead",
        email: `prospect-${RUN_ID}@example.test`,
        preferred_language: "es",
        create_case: true,
        confirm_duplicate: true,
      });
    expect(created.status).toBe(200);
    expect(created.body.client_id).toBeTruthy();
    expect(created.body.case_id).toBeTruthy();
    expect(created.body.preferred_language).toBe("es");
    seededClientIds.push(Number(created.body.client_id));

    const timeline = await request(app)
      .get(
        `/api/admin/conversations/contact/client/${created.body.client_id}/timeline`,
      )
      .set("Authorization", `Bearer ${agentToken}`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.messages?.length).toBeGreaterThan(0);
  });

  it("suggest-replies returns context without requiring AI", async () => {
    const res = await request(app)
      .post("/api/admin/conversations/suggest-replies")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        kind: "client",
        contact_id: clientId,
        recent_messages: [{ direction: "inbound", body: "Need help" }],
        include_ai: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.ai_suggestions)).toBe(true);
    expect(res.body.context?.displayName).toMatch(/Conv/);
  });

  it("rejects start with too few phone digits", async () => {
    const bad = await request(app)
      .post("/api/admin/conversations/start")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone: "55512",
        body: "hi",
        ofg_number_id: phoneNumberId,
      });
    expect(bad.status).toBe(400);
  });

  it("close/reopen inserts system events and blocks send while closed", async () => {
    await pool.query(
      `INSERT INTO conversations (client_id, channel, status, ofg_number_id, assigned_admin_id)
       VALUES (?, 'sms', 'open', ?, ?)`,
      [clientId, phoneNumberId, agentId],
    );

    const closed = await request(app)
      .post(`/api/admin/conversations/contact/client/${clientId}/status`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.system_message?.direction).toBe("system");
    expect(closed.body.system_message?.body).toBe("closed");

    const [st] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM conversations WHERE client_id = ? LIMIT 1`,
      [clientId],
    );
    expect(st[0]?.status).toBe("closed");

    const blocked = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: clientId,
        channel: "sms",
        body: `should fail ${RUN_ID}`,
        ofg_number_id: phoneNumberId,
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("conversation_closed");

    const inboxOpen = await request(app)
      .get("/api/admin/conversations")
      .set("Authorization", `Bearer ${agentToken}`)
      .query({ view: "open" });
    expect(inboxOpen.status).toBe(200);
    expect(
      (inboxOpen.body.contacts as any[]).some(
        (c) => c.kind === "client" && Number(c.contact_id) === clientId,
      ),
    ).toBe(false);

    const inboxClosed = await request(app)
      .get("/api/admin/conversations")
      .set("Authorization", `Bearer ${agentToken}`)
      .query({ view: "closed" });
    expect(inboxClosed.status).toBe(200);
    expect(
      (inboxClosed.body.contacts as any[]).some(
        (c) => c.kind === "client" && Number(c.contact_id) === clientId,
      ),
    ).toBe(true);

    const reopened = await request(app)
      .post(`/api/admin/conversations/contact/client/${clientId}/status`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ status: "open" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe("open");
    expect(reopened.body.system_message?.body).toBe("reopened");

    const timeline = await request(app)
      .get(`/api/admin/conversations/contact/client/${clientId}/timeline`)
      .set("Authorization", `Bearer ${agentToken}`);
    expect(timeline.status).toBe(200);
    const bodies = (timeline.body.messages || []).map((m: any) => m.body);
    expect(bodies).toContain("closed");
    expect(bodies).toContain("reopened");
  });

  it("unknown close/reopen mirrors client without dismissing", async () => {
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const [insU] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, ofg_number_id, status, unread_count)
       VALUES (?, ?, 'open', 0)`,
      [phone, phoneNumberId],
    );
    const unknownId = Number(insU.insertId);
    await pool.query(
      `INSERT INTO conversations
         (unknown_contact_id, channel, status, ofg_number_id, assigned_admin_id)
       VALUES (?, 'sms', 'open', ?, ?)`,
      [unknownId, phoneNumberId, agentId],
    );

    const closed = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/status`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");

    const [u] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM conversation_unknown_contacts WHERE id = ?`,
      [unknownId],
    );
    expect(u[0]?.status).toBe("open");

    const blocked = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        unknown_contact_id: unknownId,
        channel: "sms",
        body: `unknown closed ${RUN_ID}`,
        ofg_number_id: phoneNumberId,
      });
    expect(blocked.status).toBe(409);

    const startBlocked = await request(app)
      .post("/api/admin/conversations/start")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        phone,
        body: `start while closed ${RUN_ID}`,
        ofg_number_id: phoneNumberId,
      });
    expect(startBlocked.status).toBe(409);
    expect(startBlocked.body.error).toBe("conversation_closed");

    const reopened = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/status`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ status: "open" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe("open");
  });

  it("close with no threads creates a closed primary + blocks send", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('NoThread', ?, ?, '+15550119999', 'onboarding', 'new_client', 'en')`,
      [`${RUN_ID}`, `nothread-${RUN_ID}@example.test`],
    );
    const cid = Number(ins.insertId);
    seededClientIds.push(cid);

    const closed = await request(app)
      .post(`/api/admin/conversations/contact/client/${cid}/status`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.system_message?.body).toBe("closed");

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM conversations WHERE client_id = ?`,
      [cid],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "closed")).toBe(true);

    const blocked = await request(app)
      .post("/api/admin/conversations/send")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        client_id: cid,
        channel: "sms",
        body: `no thread closed ${RUN_ID}`,
        ofg_number_id: phoneNumberId,
      });
    expect(blocked.status).toBe(409);
  });
});
