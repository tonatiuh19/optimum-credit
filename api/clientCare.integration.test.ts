/**
 * Out of office + client care (Nov 17, 2026). Test client only; Slack posts and texts are dry runs in
 * tests (realMessagingBlocked); out-of-office periods are in 2099 so live routing is never affected.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { clientCareAfterInbound, clientCareMarkDone, createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const CESAR = 90001; // manager
const LECCA = 150002; // EN owner, has a line
const ANGEL = 120001; // ES owner
const PHONE = `+1555${String(Date.now()).slice(-7)}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let clientId = 0;
let conversationId = 0;
const tokens: Record<number, string> = {};

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, phone, status, pipeline_stage, preferred_language) VALUES ('Carla', 'Care', ?, ?, 'active', 'round_2', 'en')`,
    [`client-care-${Date.now()}@example.test`, PHONE],
  );
  clientId = c.insertId;
  const [[line]] = await pool.query<RowDataPacket[]>(`SELECT id FROM admin_phone_numbers WHERE assigned_admin_id = ? AND is_active = 1 LIMIT 1`, [LECCA]);
  const [cv] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations (client_id, channel, status, ofg_number_id, assigned_admin_id) VALUES (?, 'sms', 'open', ?, ?)`,
    [clientId, line?.id ?? null, LECCA],
  );
  conversationId = cv.insertId;
  for (const id of [CESAR, LECCA, ANGEL]) tokens[id] = await createSession("admin", id, `cc-${id}@example.test`, "127.0.0.1", "vitest-client-care");
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM client_care_items WHERE conversation_id = ?`, [conversationId]);
  await pool.query(`DELETE FROM conversation_messages WHERE conversation_id = ?`, [conversationId]);
  await pool.query(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`DELETE FROM admin_out_of_office WHERE starts_on >= '2099-01-01'`);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'out_of_office.set' AND changes_json LIKE '%2099-%'`);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-client-care'`).catch(() => null);
  await pool.end();
}, 60_000);

const inbound = (body: string, extra: Record<string, unknown> = {}) =>
  clientCareAfterInbound({
    conversationId, channel: "sms", clientId, fromE164: PHONE, toE164: "+19497365644", body,
    displayName: "Carla Care", linkPath: `/admin/conversations?client=${clientId}`, lineAdminId: LECCA, ...extra,
  });
const autos = async () =>
  (await pool.query<RowDataPacket[]>(`SELECT body, metadata_json FROM conversation_messages WHERE conversation_id = ? AND direction = 'outbound' AND JSON_EXTRACT(metadata_json, '$.client_care_auto') = true`, [conversationId]))[0];
const item = async () => (await pool.query<RowDataPacket[]>(`SELECT * FROM client_care_items WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`, [conversationId]))[0][0];

describe("client care", () => {
  it("STOP and a plain 'thanks' create nothing", async () => {
    expect(await inbound("STOP")).toMatchObject({ posted: false, autoReplied: false, itemId: null });
    expect(await inbound("ok thanks!")).toMatchObject({ itemId: null });
    expect(await item()).toBeUndefined();
  });

  it("first client text: personalized auto-reply (tagged as a hold) + one open item routed to the English owner", async () => {
    const r = await inbound("Hi, when will my next progress report be ready? I want to check my score");
    expect(r.autoReplied).toBe(true);
    expect(r.itemId).toBeGreaterThan(0);
    const sent = await autos();
    expect(sent).toHaveLength(1);
    expect(String(sent[0].body)).toMatch(/^Hi Carla! We got your message\. Lecca \(English, \d{3}-\d{3}-\d{4}\) will reply/);
    const meta = typeof sent[0].metadata_json === "string" ? JSON.parse(sent[0].metadata_json) : sent[0].metadata_json;
    expect(meta).toMatchObject({ inbound_ai: true, inbound_ai_hold: true, client_care_auto: true });
    expect(await item()).toMatchObject({ status: "open", lang: "en", owner_admin_id: LECCA, message_count: 1, channel: "sms" });
  });

  it("a second text within 12 hours: no second auto-reply, same item, count 2", async () => {
    const r = await inbound("Also can you send me the dispute letters");
    expect(r.autoReplied).toBe(false);
    expect(await autos()).toHaveLength(1);
    expect(await item()).toMatchObject({ status: "open", message_count: 2 });
  });

  it("the AI already replied: no auto-reply", async () => {
    await pool.query(`UPDATE client_care_items SET status = 'done' WHERE conversation_id = ?`, [conversationId]);
    await pool.query(`UPDATE conversation_messages SET created_at = DATE_SUB(created_at, INTERVAL 13 HOUR) WHERE conversation_id = ?`, [conversationId]);
    const r = await inbound("What is my balance due this month", { aiReplied: true });
    expect(r.autoReplied).toBe(false);
  });

  it("a staff reply in OFG closes the item", async () => {
    expect(await clientCareMarkDone(conversationId, "ofg_reply", LECCA)).toBe(1);
    expect(await item()).toMatchObject({ status: "done", done_how: "ofg_reply", done_by_admin_id: LECCA });
  });
});

describe("out of office routes", () => {
  const body = { starts_on: "2099-01-01", returns_on: "2099-01-05", backup_en_admin_id: LECCA, backup_es_admin_id: ANGEL };
  const as = (id: number) => ({
    get: () => request(app).get("/api/admin/out-of-office").set("Authorization", `Bearer ${tokens[id]}`),
    post: (b: object) => request(app).post("/api/admin/out-of-office").set("Authorization", `Bearer ${tokens[id]}`).send(b),
    del: (pid: number) => request(app).delete(`/api/admin/out-of-office/${pid}`).set("Authorization", `Bearer ${tokens[id]}`),
  });

  it("set your own; a manager can set someone else's; staff cannot", async () => {
    expect((await request(app).get("/api/admin/out-of-office")).status).toBe(401);
    const mine = await as(CESAR).post(body);
    expect(mine.status).toBe(201);
    expect(mine.body.periods[0]).toMatchObject({ admin_id: CESAR, starts_on: "2099-01-01", returns_on: "2099-01-05", backup_en: { id: LECCA }, backup_es: { id: ANGEL }, active: false });
    expect((await as(LECCA).post({ ...body, admin_id: ANGEL, backup_en_admin_id: CESAR })).status).toBe(403);
    expect((await as(CESAR).post({ ...body, admin_id: ANGEL, backup_es_admin_id: LECCA })).status).toBe(201);
  });

  it("validation: the person away cannot be their own backup; bad dates refused", async () => {
    expect((await as(LECCA).post({ ...body, backup_en_admin_id: LECCA })).status).toBe(400);
    expect((await as(LECCA).post({ ...body, returns_on: "2098-12-31" })).status).toBe(400);
  });

  it("a new overlapping period replaces the old one; cancel is owner-or-manager only", async () => {
    await as(CESAR).post({ ...body, returns_on: "2099-01-07" });
    const list = await as(CESAR).get();
    const cesar = list.body.everyone.filter((p: { admin_id: number; starts_on: string }) => p.admin_id === CESAR && p.starts_on.startsWith("2099"));
    expect(cesar).toHaveLength(1);
    expect(cesar[0].returns_on).toBe("2099-01-07");
    expect(list.body.can_manage_others).toBe(true);
    expect((await as(LECCA).del(cesar[0].id)).status).toBe(403);
    expect((await as(CESAR).del(cesar[0].id)).status).toBe(200);
  });
});

describe("client care settings routes (only validation + reset — never custom texts on the shared DB)", () => {
  const put = (id: number, b: object) => request(app).put("/api/admin/client-care/settings").set("Authorization", `Bearer ${tokens[id]}`).send(b);
  it("everyone reads; only managers save; bad input refused; reset brings the defaults back", async () => {
    const got = await request(app).get("/api/admin/client-care/settings").set("Authorization", `Bearer ${tokens[LECCA]}`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ can_edit: false, tokens: expect.arrayContaining(["first_name", "owner", "when"]) });
    expect(got.body.defaults.templates.en.message).toMatch(/\{owner\}/);
    expect((await put(LECCA, { reset: true })).status).toBe(403);
    expect((await put(CESAR, { templates: { en: { message: "no placeholders" } } })).status).toBe(400);
    expect((await put(CESAR, { escalate_admin_ids: [999999999] })).status).toBe(400);
    expect((await put(CESAR, { business_start: "19:00", business_end: "08:00" })).status).toBe(400);
    const reset = await put(CESAR, { reset: true });
    expect(reset.status).toBe(200);
    expect(reset.body.settings).toEqual(got.body.defaults);
  });
});

