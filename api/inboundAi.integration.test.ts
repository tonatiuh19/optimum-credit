/**
 * Inbound AI SMS — STOP / client / CRM / unknown with async flush.
 * Gates enabled only for this suite; restored in afterAll.
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
import { createServer, createSession, flushInboundAiJobs } from "./index";
import {
  cleanupIntegrationTestAdmins,
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
  uniqueTestE164,
} from "./testDbCleanup";

const RUN_ID = `iniai-${Date.now()}`;
const AGENT_EMAIL = `iniai-agent-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let agentToken = "";
let phoneNumberId = 0;
let ofgE164 = "";
let clientId = 0;
let contactId = 0;
const seededClientIds: number[] = [];

const prevSms = process.env.INBOUND_AI_SMS_ENABLED;
const prevVoice = process.env.INBOUND_AI_VOICE_ENABLED;
const prevKey = process.env.ANTHROPIC_API_KEY;
const prevAllow = process.env.INBOUND_AI_ADMIN_IDS;

describe("inbound AI SMS webhook", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    process.env.INBOUND_AI_SMS_ENABLED = "1";
    // Keep Claude off for deterministic STOP/unknown paths; escalate without API.
    delete process.env.ANTHROPIC_API_KEY;
    // Clear César-only allowlist from local .env so the fixture agent can run AI.
    delete process.env.INBOUND_AI_ADMIN_IDS;
    process.env.VITEST = "true";

    pool = createIntegrationTestPool();
    app = createServer();

    const [aIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language, phone)
       VALUES (?, 'InAi', 'Agent', 'agent', 'active', 'en', '+15551234991')`,
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

    ofgE164 = uniqueTestE164(`${RUN_ID}-ofg`);
    const [pIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Inbound AI OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [ofgE164, agentId],
    );
    phoneNumberId = Number(pIns.insertId);

    const clientPhone = uniqueTestE164(`${RUN_ID}-cli`);
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('InAi', 'Client', ?, ?, 'prospect', 'prospect', 'en')`,
      [`iniai-client-${RUN_ID}@example.test`, clientPhone],
    );
    clientId = Number(cIns.insertId);
    seededClientIds.push(clientId);

    const contactPhone = uniqueTestE164(`${RUN_ID}-ctc`);
    const [ctIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO contacts
         (first_name, last_name, email, phone, preferred_language, assigned_admin_id)
       VALUES ('InAi', 'Contact', ?, ?, 'en', ?)`,
      [`iniai-contact-${RUN_ID}@example.test`, contactPhone, agentId],
    );
    contactId = Number(ctIns.insertId);
  }, 60_000);

  afterAll(async () => {
    await flushInboundAiJobs();
    if (prevSms === undefined) delete process.env.INBOUND_AI_SMS_ENABLED;
    else process.env.INBOUND_AI_SMS_ENABLED = prevSms;
    if (prevVoice === undefined) delete process.env.INBOUND_AI_VOICE_ENABLED;
    else process.env.INBOUND_AI_VOICE_ENABLED = prevVoice;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevAllow === undefined) delete process.env.INBOUND_AI_ADMIN_IDS;
    else process.env.INBOUND_AI_ADMIN_IDS = prevAllow;

    if (contactId) {
      await pool
        .query(`DELETE FROM conversation_messages WHERE conversation_id IN (
          SELECT id FROM conversations WHERE contact_id = ?
        )`, [contactId])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM conversations WHERE contact_id = ?`, [contactId])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM contacts WHERE id = ?`, [contactId])
        .catch(() => undefined);
    }
    if (phoneNumberId) {
      await pool
        .query(
          `DELETE FROM conversation_messages WHERE conversation_id IN (
             SELECT id FROM conversations WHERE ofg_number_id = ?
           )`,
          [phoneNumberId],
        )
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM conversations WHERE ofg_number_id = ?`, [
          phoneNumberId,
        ])
        .catch(() => undefined);
      await pool
        .query(
          `DELETE FROM conversation_unknown_contacts WHERE ofg_number_id = ?`,
          [phoneNumberId],
        )
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId])
        .catch(() => undefined);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: seededClientIds,
    });
    await cleanupIntegrationTestAdmins(pool, [agentId]);
    await pool.end().catch(() => undefined);
  }, 60_000);

  it("STOP keyword: no outbound hold SMS; system escalate note after flush", async () => {
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const from = String(crows[0]?.phone || "");
    const sid = `SM_stop_${RUN_ID}`;
    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: ofgE164,
        Body: "STOP",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);
    expect(String(wh.text || "")).toMatch(/Response/i);

    await flushInboundAiJobs();

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.direction, m.body, m.metadata_json
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND c.channel = 'sms'
       ORDER BY m.id DESC LIMIT 8`,
      [clientId],
    );
    const inbound = msgs.find(
      (m) => m.direction === "inbound" && String(m.body) === "STOP",
    );
    expect(inbound).toBeTruthy();
    const outboundAi = msgs.filter(
      (m) =>
        m.direction === "outbound" &&
        String(JSON.stringify(m.metadata_json || "")).includes("inbound_ai"),
    );
    expect(outboundAi.length).toBe(0);
    const sys = msgs.find(
      (m) =>
        m.direction === "system" &&
        String(m.body || "").includes("Escalated") &&
        String(m.body || "").toLowerCase().includes("stop"),
    );
    expect(sys).toBeTruthy();
  });

  it("blocked client: no AI reply at all; escalated to staff", async () => {
    await pool.query(`UPDATE clients SET status = 'blocked' WHERE id = ?`, [clientId]);
    try {
      const [crows] = await pool.query<RowDataPacket[]>(`SELECT phone FROM clients WHERE id = ?`, [clientId]);
      const body = `Where is my report? ${RUN_ID}`;
      const wh = await request(app)
        .post("/api/webhooks/twilio/sms")
        .type("form")
        .send({ From: String(crows[0].phone), To: ofgE164, Body: body, MessageSid: `SM_blk_${RUN_ID}` });
      expect(wh.status).toBe(200);
      await flushInboundAiJobs();
      const [msgs] = await pool.query<RowDataPacket[]>(
        `SELECT m.id, m.direction, m.body, m.metadata_json
         FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.client_id = ? AND c.channel = 'sms' ORDER BY m.id ASC`,
        [clientId],
      );
      const inIdx = msgs.findIndex((m) => m.direction === "inbound" && String(m.body) === body);
      expect(inIdx).toBeGreaterThanOrEqual(0);
      const after = msgs.slice(inIdx + 1);
      expect(after.filter((m) => m.direction === "outbound").length).toBe(0);
      expect(after.some((m) => m.direction === "system" && /blocked/i.test(String(m.body)))).toBe(true);
    } finally {
      await pool.query(`UPDATE clients SET status = 'prospect' WHERE id = ?`, [clientId]);
    }
  });

  it("unknown number: hard-escalates with hold SMS after flush", async () => {
    const unknownPhone = uniqueTestE164(`${RUN_ID}-unk`);
    const sid = `SM_unk_${RUN_ID}`;
    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: ofgE164,
        Body: "Hi what are your hours?",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);
    await flushInboundAiJobs();

    const [urows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversation_unknown_contacts
       WHERE phone_e164 = ? AND ofg_number_id = ? LIMIT 1`,
      [unknownPhone, phoneNumberId],
    );
    expect(urows[0]).toBeTruthy();
    const unknownId = Number(urows[0].id);

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.direction, m.body, m.metadata_json
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.unknown_contact_id = ? AND c.channel = 'sms'
       ORDER BY m.id ASC`,
      [unknownId],
    );
    expect(msgs.some((m) => m.direction === "inbound")).toBe(true);
    const hold = msgs.find(
      (m) =>
        m.direction === "outbound" &&
        String(JSON.stringify(m.metadata_json || "")).includes("inbound_ai"),
    );
    expect(hold).toBeTruthy();
    expect(String(hold?.body || "")).toMatch(/teammate|equipo/i);
  });

  it("CRM contact + HELP: sends compliance HELP reply", async () => {
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM contacts WHERE id = ? LIMIT 1`,
      [contactId],
    );
    const from = String(crows[0]?.phone || "");
    const sid = `SM_help_${RUN_ID}`;
    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: ofgE164,
        Body: "HELP",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);
    await flushInboundAiJobs();

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.direction, m.body, m.metadata_json
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.contact_id = ? AND c.channel = 'sms'
       ORDER BY m.id DESC LIMIT 6`,
      [contactId],
    );
    const helpOut = msgs.find(
      (m) =>
        m.direction === "outbound" &&
        String(m.body || "").includes("844") &&
        String(JSON.stringify(m.metadata_json || "")).includes("inbound_ai"),
    );
    expect(helpOut).toBeTruthy();
  });

  it("gates off: no AI system notes when SMS flag disabled", async () => {
    process.env.INBOUND_AI_SMS_ENABLED = "0";
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const from = String(crows[0]?.phone || "");
    const sid = `SM_off_${RUN_ID}`;
    const [beforeRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND m.direction = 'system'
         AND m.body LIKE '%Inbound AI%'`,
      [clientId],
    );
    const nBefore = Number(beforeRows[0]?.n || 0);

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: ofgE164,
        Body: "Just checking in",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);
    await flushInboundAiJobs();

    const [afterRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND m.direction = 'system'
         AND m.body LIKE '%Inbound AI%'`,
      [clientId],
    );
    expect(Number(afterRows[0]?.n || 0)).toBe(nBefore);

    // restore for any later tests in file
    process.env.INBOUND_AI_SMS_ENABLED = "1";
  });

  it("allowlist skip: AI does not run when line owner not in INBOUND_AI_ADMIN_IDS", async () => {
    process.env.INBOUND_AI_SMS_ENABLED = "1";
    // Fixture agent is not César (90001) — simulate César-only rollout.
    process.env.INBOUND_AI_ADMIN_IDS = "90001";
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const from = String(crows[0]?.phone || "");
    const sid = `SM_allow_${RUN_ID}`;

    const countAiArtifacts = async () => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT m.direction, m.body, m.metadata_json
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.client_id = ? AND c.channel = 'sms'`,
        [clientId],
      );
      return rows.filter(
        (m) =>
          (m.direction === "system" &&
            String(m.body || "").includes("Inbound AI")) ||
          (m.direction === "outbound" &&
            String(JSON.stringify(m.metadata_json || "")).includes(
              "inbound_ai",
            )),
      ).length;
    };
    const nBefore = await countAiArtifacts();

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: from,
        To: ofgE164,
        Body: "STOP",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);
    await flushInboundAiJobs();

    expect(await countAiArtifacts()).toBe(nBefore);

    // Inbound SMS still persisted (routing unchanged)
    const [inbound] = await pool.query<RowDataPacket[]>(
      `SELECT m.id FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND m.provider_message_id = ? LIMIT 1`,
      [clientId, sid],
    );
    expect(inbound[0]).toBeTruthy();

    delete process.env.INBOUND_AI_ADMIN_IDS;
  });

  it("access still requires conversations for staff UI", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/access")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
  });
});
