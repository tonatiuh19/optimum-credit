/**
 * SMS AI end-to-end with a scripted Claude answer: safe replies are sent with
 * the automated-assistant disclosure and the thread stays open; replies that
 * break the rules (unapproved link) are never sent — staff get the draft.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let claudeReply: Record<string, unknown> = {};
vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  const ax = actual.default as any;
  const realPost = ax.post.bind(ax);
  ax.post = (url: string, ...rest: unknown[]) =>
    String(url).includes("api.anthropic.com")
      ? Promise.resolve({
          status: 200,
          data: {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", name: "triage_decision", input: claudeReply }],
          },
        })
      : realPost(url, ...rest);
  return actual;
});

import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, flushInboundAiJobs } from "./index";
import { createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const RUN = `aiguard-${Date.now()}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let phoneId = 0;
let ofgE164 = "";
let clientId = 0;
let clientPhone = "";
const saved = {
  sms: process.env.INBOUND_AI_SMS_ENABLED,
  key: process.env.ANTHROPIC_SMS_API_KEY,
  ws: process.env.ANTHROPIC_SMS_WORKSPACE_ID,
  allow: process.env.INBOUND_AI_ADMIN_IDS,
};

async function textIn(body: string, sid: string) {
  const res = await request(app)
    .post("/api/webhooks/twilio/sms")
    .type("form")
    .send({ From: clientPhone, To: ofgE164, Body: body, MessageSid: sid });
  expect(res.status).toBe(200);
  await flushInboundAiJobs();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.direction, m.body, m.metadata_json, c.status AS thread_status
     FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.client_id = ? AND c.channel = 'sms' ORDER BY m.id ASC`,
    [clientId],
  );
  return rows;
}

describe("SMS AI reply guard (end-to-end)", () => {
  beforeAll(async () => {
    process.env.INBOUND_AI_SMS_ENABLED = "1";
    process.env.ANTHROPIC_SMS_API_KEY = "sk-test";
    delete process.env.ANTHROPIC_SMS_WORKSPACE_ID;
    delete process.env.INBOUND_AI_ADMIN_IDS;
    pool = createIntegrationTestPool();
    app = createServer();
    const [a] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Guard', 'Agent', 'agent', 'active', 'en')`,
      [`${RUN}@example.test`],
    );
    agentId = a.insertId;
    ofgE164 = uniqueTestE164(`${RUN}-ofg`);
    const [p] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Guard OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [ofgE164, agentId],
    );
    phoneId = p.insertId;
    clientPhone = uniqueTestE164(`${RUN}-cli`);
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Guard', 'Client', ?, ?, 'active', 'round_2', 'en')`,
      [`${RUN}-c@example.test`, clientPhone],
    );
    clientId = c.insertId;
  }, 60_000);

  afterAll(async () => {
    await flushInboundAiJobs();
    for (const [k, v] of [
      ["INBOUND_AI_SMS_ENABLED", saved.sms],
      ["ANTHROPIC_SMS_API_KEY", saved.key],
      ["ANTHROPIC_SMS_WORKSPACE_ID", saved.ws],
      ["INBOUND_AI_ADMIN_IDS", saved.allow],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await pool.query(
      `DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id = ?)`,
      [phoneId],
    );
    await pool.query(`DELETE FROM conversations WHERE ofg_number_id = ?`, [phoneId]);
    await pool.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneId]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await pool.query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [agentId]).catch(() => null);
    await pool.query(`DELETE FROM admins WHERE id = ?`, [agentId]);
    await pool.end();
  });

  it("sends a safe answer with no assistant label and keeps the thread open", async () => {
    claudeReply = {
      action: "resolve",
      reply: "You're in round 2. You can see your reports in the client portal.",
      summary: "round status",
      confidence: 0.9,
      escalate_reason: null,
    };
    const rows = await textIn("What round am I in?", `SM1${RUN}`);
    const out = rows.filter((r) => r.direction === "outbound");
    expect(out[out.length - 1]?.body).toMatch(/^You're in round 2/);
    expect(rows[rows.length - 1]?.thread_status).toBe("open");
  });

  it("never sends a reply with an unapproved link — escalates with the draft", async () => {
    claudeReply = {
      action: "reply",
      reply: "Log in here: https://phishy.example/login",
      summary: "link",
      confidence: 0.9,
      escalate_reason: null,
    };
    const rows = await textIn("Where do I log in?", `SM2${RUN}`);
    const out = rows.filter((r) => r.direction === "outbound");
    expect(out.some((r) => String(r.body).includes("phishy"))).toBe(false);
    expect(out[out.length - 1]?.body).toMatch(/teammate/i);
    const note = rows.find((r) => String(r.body).includes("reply_guard:unapproved_link"));
    expect(note).toBeTruthy();
  });
});
