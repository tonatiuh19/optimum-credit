/**
 * SMS AI live lookups (Nov 8, 2026): the AI answers read-only questions from
 * the sender's OWN data. Security checks:
 *  - lookups are bound to the server-verified client; ids in the arguments are ignored
 *  - a phone shared by two clients, a CRM contact or an unknown number gets no account data
 *  - unverified senders are never even offered the account tools
 *  - the only write (callback) is one staff task per thread
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Scripted Claude: each call shifts the next response; request bodies are kept. */
let script: Array<Record<string, unknown>> = [];
const sentBodies: any[] = [];
vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  const ax = actual.default as any;
  const realPost = ax.post.bind(ax);
  ax.post = (url: string, body: unknown, ...rest: unknown[]) => {
    if (!String(url).includes("api.anthropic.com")) return realPost(url, body, ...rest);
    sentBodies.push(JSON.parse(JSON.stringify(body)));
    const next = script.shift() ?? { type: "tool_use", id: "d", name: "triage_decision", input: { action: "escalate", reply: "", summary: "end", confidence: 1, escalate_reason: "other" } };
    return Promise.resolve({ status: 200, data: { stop_reason: "tool_use", content: [next] } });
  };
  return actual;
});

import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  countClientsByPhone,
  createServer,
  executeInboundAiTool,
  flushInboundAiJobs,
  inboundAiIdentityFor,
  inboundAiToolsForIdentity,
} from "./index";
import { createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const RUN = `ailookup-${Date.now()}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let phoneId = 0;
let ofgE164 = "";
const ids = { a: 0, b: 0, s1: 0, s2: 0, caseA: 0, caseB: 0 };
const phones = { a: "", b: "", shared: "" };
const saved = {
  sms: process.env.INBOUND_AI_SMS_ENABLED,
  key: process.env.ANTHROPIC_SMS_API_KEY,
  ws: process.env.ANTHROPIC_SMS_WORKSPACE_ID,
  allow: process.env.INBOUND_AI_ADMIN_IDS,
  voice: process.env.INBOUND_AI_VOICE_ENABLED,
  mainKey: process.env.ANTHROPIC_API_KEY,
};

const CLIENT_TOOLS = ["get_my_account", "get_my_rounds", "get_my_reports", "get_my_documents", "get_my_payments", "get_my_onboarding_tasks"];
const ctxFor = (identity: "client" | "contact" | "unverified", clientId: number | null) => ({
  identity,
  clientId,
  conversationId: 0,
  displayName: "Test",
  lang: "en" as const,
  assigneeAdminId: agentId,
  allowedUrls: [],
  grounding: [],
  toolsUsed: [],
  callbackRequested: false,
});

async function addClient(first: string, phone: string): Promise<number> {
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
     VALUES (?, 'Lookup', ?, ?, 'active', 'round_2', 'en')`,
    [first, `${RUN}-${first}@example.test`, phone],
  );
  return c.insertId;
}
async function addCaseWithInstallment(clientId: number, cents: number): Promise<number> {
  const [k] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_2', 'active')`,
    [clientId],
  );
  await pool.query(
    `INSERT INTO payment_splits (case_id, client_id, label, amount_cents, due_date, status)
     VALUES (?, ?, 'Installment', ?, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'pending')`,
    [k.insertId, clientId, cents],
  );
  await pool.query(
    `INSERT INTO payments (client_id, case_id, amount_cents, status, provider, paid_at) VALUES (?, ?, ?, 'succeeded', 'manual', NOW())`,
    [clientId, k.insertId, cents],
  );
  return k.insertId;
}

async function textIn(from: string, body: string, sid: string) {
  const res = await request(app)
    .post("/api/webhooks/twilio/sms")
    .type("form")
    .send({ From: from, To: ofgE164, Body: body, MessageSid: sid });
  expect(res.status).toBe(200);
  await flushInboundAiJobs();
}
async function outbound(clientId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.direction, m.body FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.client_id = ? AND c.channel = 'sms' ORDER BY m.id ASC`,
    [clientId],
  );
  return rows;
}

describe("SMS AI lookups are locked to the sender", () => {
  beforeAll(async () => {
    process.env.INBOUND_AI_SMS_ENABLED = "1";
    process.env.ANTHROPIC_SMS_API_KEY = "sk-test";
    process.env.INBOUND_AI_VOICE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.ANTHROPIC_SMS_WORKSPACE_ID;
    delete process.env.INBOUND_AI_ADMIN_IDS;
    pool = createIntegrationTestPool();
    app = createServer();
    const [a] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Lookup', 'Agent', 'agent', 'active', 'en')`,
      [`${RUN}@example.test`],
    );
    agentId = a.insertId;
    ofgE164 = uniqueTestE164(`${RUN}-ofg`);
    const [p] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Lookup OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [ofgE164, agentId],
    );
    phoneId = p.insertId;
    phones.a = uniqueTestE164(`${RUN}-a`);
    phones.b = uniqueTestE164(`${RUN}-b`);
    phones.shared = uniqueTestE164(`${RUN}-s`);
    ids.a = await addClient("Ana", phones.a);
    ids.b = await addClient("Beto", phones.b);
    ids.s1 = await addClient("Sara", phones.shared);
    ids.s2 = await addClient("Saul", phones.shared);
    ids.caseA = await addCaseWithInstallment(ids.a, 12300);
    ids.caseB = await addCaseWithInstallment(ids.b, 77700);
  }, 60_000);

  afterAll(async () => {
    await flushInboundAiJobs();
    for (const [k, v] of [
      ["INBOUND_AI_SMS_ENABLED", saved.sms],
      ["ANTHROPIC_SMS_API_KEY", saved.key],
      ["ANTHROPIC_SMS_WORKSPACE_ID", saved.ws],
      ["INBOUND_AI_ADMIN_IDS", saved.allow],
      ["INBOUND_AI_VOICE_ENABLED", saved.voice],
      ["ANTHROPIC_API_KEY", saved.mainKey],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const all = [ids.a, ids.b, ids.s1, ids.s2];
    await pool.query(
      `DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id = ?)`,
      [phoneId],
    );
    await pool.query(`DELETE FROM conversations WHERE ofg_number_id = ?`, [phoneId]);
    await pool.query(`DELETE FROM admin_work_tasks WHERE assignee_admin_id = ?`, [agentId]);
    await pool.query(`DELETE FROM payments WHERE client_id IN (?)`, [all]);
    await pool.query(`DELETE FROM payment_splits WHERE client_id IN (?)`, [all]);
    await pool.query(`DELETE FROM credit_repair_cases WHERE client_id IN (?)`, [all]);
    await pool.query(`DELETE FROM client_file_notes WHERE client_id IN (?)`, [all]).catch(() => null);
    await pool.query(`DELETE FROM clients WHERE id IN (?)`, [all]);
    await pool.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneId]);
    await pool.query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [agentId]).catch(() => null);
    await pool.query(`DELETE FROM admins WHERE id = ?`, [agentId]);
    await pool.end();
  });

  it("identity: one client per phone = client; shared phone, contact or unknown = no account data", async () => {
    expect(await countClientsByPhone(phones.a)).toBe(1);
    expect(await countClientsByPhone(phones.shared)).toBe(2);
    expect(inboundAiIdentityFor({ clientId: ids.a, clientsOnPhone: 1, crmContactId: null })).toBe("client");
    expect(inboundAiIdentityFor({ clientId: ids.s2, clientsOnPhone: 2, crmContactId: null })).toBe("unverified");
    expect(inboundAiIdentityFor({ clientId: null, clientsOnPhone: 0, crmContactId: 5 })).toBe("contact");
    expect(inboundAiIdentityFor({ clientId: null, clientsOnPhone: 0, crmContactId: null })).toBe("unverified");
  });

  it("unverified senders and contacts are never offered account tools", () => {
    for (const who of ["unverified", "contact"] as const) {
      const names = inboundAiToolsForIdentity(who).map((t) => t.name);
      for (const t of CLIENT_TOOLS) expect(names).not.toContain(t);
      expect(names).toEqual(expect.arrayContaining(["search_faq", "list_services", "request_callback"]));
    }
    expect(inboundAiToolsForIdentity("client").map((t) => t.name)).toEqual(expect.arrayContaining(CLIENT_TOOLS));
  });

  it("no tool takes an id: injected client/case ids are ignored", async () => {
    for (const t of inboundAiToolsForIdentity("client")) {
      const props = Object.keys(((t.input_schema as any).properties ?? {}) as object);
      expect(props.some((p) => /id$|client|case|phone|email|name/i.test(p))).toBe(false);
    }
    const out = await executeInboundAiTool("get_my_payments", { client_id: ids.b, case_id: ids.caseB }, ctxFor("client", ids.a));
    const s = JSON.stringify(out);
    expect(s).toContain("$123");
    expect(s).not.toContain("$777");
  });

  it("every account tool refuses without a verified client (even if the model calls it anyway)", async () => {
    for (const t of CLIENT_TOOLS) {
      for (const ctx of [ctxFor("unverified", ids.a), ctxFor("contact", ids.a), ctxFor("client", null)]) {
        const out = await executeInboundAiTool(t, {}, ctx);
        expect(out.error).toBe("not_verified");
      }
    }
    expect((await executeInboundAiTool("delete_client", {}, ctxFor("client", ids.a))).error).toBe("unknown_tool");
  });

  it("results carry no internal fields", async () => {
    await pool.query(`UPDATE clients SET admin_notes = 'SECRET-NOTE', ssn_last4 = '9876' WHERE id = ?`, [ids.a]);
    for (const t of CLIENT_TOOLS) {
      const s = JSON.stringify(await executeInboundAiTool(t, { round_number: 1 }, ctxFor("client", ids.a)));
      expect(s).not.toContain("SECRET-NOTE");
      expect(s).not.toContain("9876");
      expect(s).not.toContain("Beto");
    }
  });

  it("callback creates one staff task per thread", async () => {
    const ctx = { ...ctxFor("client", ids.a), conversationId: 900000000 + (Date.now() % 1000000) };
    expect(await executeInboundAiTool("request_callback", { preferred_time: "after 3pm" }, ctx)).toMatchObject({ ok: true });
    expect(await executeInboundAiTool("request_callback", {}, ctx)).toMatchObject({ ok: true, already_requested: true });
    const [t] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) n, MAX(labels_json) labels FROM admin_work_tasks WHERE assignee_admin_id = ? AND description LIKE ?`,
      [agentId, `%Thread ref #${ctx.conversationId}.%`],
    );
    expect(Number(t[0].n)).toBe(1);
    // Only readable labels are shown on the task.
    const labels = typeof t[0].labels === "string" ? JSON.parse(t[0].labels) : t[0].labels;
    expect(labels).toEqual(["callback", "inbound_ai"]);
  });

  it("end to end: looks up the sender's installment and answers with it", async () => {
    sentBodies.length = 0;
    script = [
      { type: "tool_use", id: "t1", name: "get_my_payments", input: { client_id: ids.b } },
      {
        type: "tool_use",
        id: "t2",
        name: "triage_decision",
        input: { action: "resolve", reply: "Your next installment is $123.", summary: "next payment", confidence: 0.9, escalate_reason: null },
      },
    ];
    await textIn(phones.a, "How much is my next payment?", `SMa${RUN}`);
    const rows = await outbound(ids.a);
    const out = rows.filter((r) => r.direction === "outbound");
    expect(out[out.length - 1]?.body).toMatch(/\$123/);
    // Second Claude call carried the lookup result: Ana's amount only.
    const second = JSON.stringify(sentBodies[1]?.messages ?? []);
    expect(second).toContain("$123");
    expect(second).not.toContain("$777");
    expect(rows.some((r) => String(r.body).includes("Looked up: get_my_payments"))).toBe(true);
  });

  it("end to end: a shared phone gets no account tools and no client's data", async () => {
    sentBodies.length = 0;
    script = [
      {
        type: "tool_use",
        id: "t3",
        name: "triage_decision",
        input: { action: "resolve", reply: "I can't share account details by text here; a teammate can help.", summary: "shared phone", confidence: 0.9, escalate_reason: null },
      },
    ];
    await textIn(phones.shared, "What round am I in?", `SMs${RUN}`);
    const offered = (sentBodies[0]?.tools ?? []).map((t: any) => t.name);
    for (const t of CLIENT_TOOLS) expect(offered).not.toContain(t);
    const prompt = JSON.stringify(sentBodies[0]?.messages ?? []);
    expect(prompt).toContain("Identity: unverified");
    expect(prompt).not.toMatch(/Sara|Saul|round_2/);
  });

  it("missing documents use the onboarding required set", async () => {
    const out = (await executeInboundAiTool("get_my_documents", {}, ctxFor("client", ids.a))) as any;
    expect(out.missing_required).toEqual(["id_front", "id_back", "ssn_card", "proof_of_address"]);
  });

  it("end to end: a Spanish day-first date from a lookup is not blocked", async () => {
    await pool.query(`UPDATE clients SET preferred_language = 'es' WHERE id = ?`, [ids.a]);
    const [due] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(due_date, '%d/%m/%Y') d FROM payment_splits WHERE client_id = ? LIMIT 1`,
      [ids.a],
    );
    script = [
      { type: "tool_use", id: "t4", name: "get_my_payments", input: {} },
      { type: "tool_use", id: "t5", name: "triage_decision", input: { action: "resolve", reply: `Tu próximo pago es $123 el ${due[0].d}.`, summary: "pago", confidence: 0.9, escalate_reason: null } },
    ];
    await textIn(phones.a, "Cuándo es mi próximo pago?", `SMd${RUN}`);
    const out = (await outbound(ids.a)).filter((r) => r.direction === "outbound");
    expect(out[out.length - 1]?.body).toContain(due[0].d);
    await pool.query(`UPDATE clients SET preferred_language = 'en' WHERE id = ?`, [ids.a]);
  });

  it("end to end: an invented date is still blocked", async () => {
    script = [
      { type: "tool_use", id: "t6", name: "triage_decision", input: { action: "resolve", reply: "Your next round is on 01/02/2031.", summary: "x", confidence: 0.9, escalate_reason: null } },
    ];
    await textIn(phones.a, "When is my next round exactly?", `SMx${RUN}`);
    const out = (await outbound(ids.a)).filter((r) => r.direction === "outbound");
    expect(out.some((r) => String(r.body).includes("2031"))).toBe(false);
  });

  it("end to end: thanks / reactions get no AI reply and no Claude call", async () => {
    const before = (await outbound(ids.b)).filter((r) => r.direction === "outbound").length;
    sentBodies.length = 0;
    await textIn(phones.b, "Thank you!", `SMk${RUN}`);
    await textIn(phones.b, "Liked “Hi, it's Cesar.”", `SMl${RUN}`);
    expect(sentBodies.length).toBe(0);
    expect((await outbound(ids.b)).filter((r) => r.direction === "outbound").length).toBe(before);
  });

  it("end to end: an escalation hold that breaks the rules is replaced by the standard hold", async () => {
    script = [
      { type: "tool_use", id: "t7", name: "triage_decision", input: { action: "escalate", reply: "Pay here: https://evil.example/pay", summary: "x", confidence: 1, escalate_reason: "payment_action" } },
    ];
    await textIn(phones.b, "I want to change my card", `SMe${RUN}`);
    const out = (await outbound(ids.b)).filter((r) => r.direction === "outbound");
    expect(out.some((r) => String(r.body).includes("evil.example"))).toBe(false);
    expect(out[out.length - 1]?.body).toMatch(/teammate/i);
  });

  it("end to end: a staff text in the last 24h keeps the AI out", async () => {
    const [cv] = await pool.query<RowDataPacket[]>(`SELECT id FROM conversations WHERE client_id = ? AND channel = 'sms' LIMIT 1`, [ids.b]);
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, direction, channel, body, created_at) VALUES (?, 'outbound', 'sms', 'Hi from staff', NOW() - INTERVAL 20 HOUR)`,
      [cv[0].id],
    );
    sentBodies.length = 0;
    await textIn(phones.b, "What round am I in?", `SMq${RUN}`);
    expect(sentBodies.length).toBe(0);
  });

  const voiceTurn = (from: string, clientId: number, speech: string) =>
    request(app)
      .post(`/api/voice/ai-turn?turns=0&client=${clientId}&admin=${agentId}&ofg=${phoneId}`)
      .type("form")
      .send({ From: from, To: ofgE164, SpeechResult: speech, CallSid: `CA${RUN}${Math.random()}` });
  const decide = (reply: string) => [
    { type: "tool_use", id: "v", name: "triage_decision", input: { action: "resolve", reply, summary: "voice", confidence: 0.9, escalate_reason: null } },
  ];

  it("voice: a verified caller hears their own data (prefetched, single Claude call)", async () => {
    sentBodies.length = 0;
    script = decide("Your next installment is $123.");
    const res = await voiceTurn(phones.a, ids.a, "How much is my next payment?");
    expect(res.text).toContain("$123");
    expect(sentBodies.length).toBe(1);
    const prompt = JSON.stringify(sentBodies[0].messages);
    expect(prompt).toContain("Identity: client");
    expect(prompt).toContain("$123");
    expect(prompt).not.toContain("$777");
  });

  it("voice: a shared phone gets no account data", async () => {
    sentBodies.length = 0;
    script = decide("I can't share account details on this line; a teammate can help.");
    await voiceTurn(phones.shared, ids.s2, "What round am I in?");
    const prompt = JSON.stringify(sentBodies[0].messages);
    expect(prompt).toContain("Identity: unverified");
    expect(prompt).not.toMatch(/Sara|Saul|get_my_|\$123|\$777/);
  });

  it("voice: an invented amount is never spoken — the call goes to a person", async () => {
    script = decide("Your balance is $999.");
    const res = await voiceTurn(phones.a, ids.a, "What's my balance?");
    expect(res.text).not.toContain("$999");
    expect(res.text).toMatch(/<Dial|connecting/i);
  });

  it("shared phone: staff get one notice naming every client on the number", async () => {
    script = decide("Thanks!");
    await textIn(phones.shared, "Hello?", `SMn${RUN}`);
    await textIn(phones.shared, "Anyone there?", `SMm${RUN}`);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.body FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id IN (?, ?) AND m.direction = 'system' AND m.body LIKE '[Shared phone]%'`,
      [ids.s1, ids.s2],
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].body)).toMatch(/Sara/);
    expect(String(rows[0].body)).toMatch(/Saul/);
  });
});
