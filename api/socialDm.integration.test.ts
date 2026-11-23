/**
 * Facebook Messenger + Instagram DMs in Conversations (Nov 10, 2026):
 *  - every webhook POST must carry Meta's X-Hub-Signature-256 (app secret)
 *  - new sender → unknown-contact thread on the right channel, routed by language
 *  - duplicates (Meta retries) are ignored; Page echoes keep the thread complete
 *  - inbox replies go through the Graph Send API within Meta's window
 *    (24h standard, 7 days HUMAN_AGENT, then refused)
 *  - after "link to client", the person's next DM lands on the client's record
 *  - Social tab lists social senders; the SMS tab never shows them
 */
import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const graphCalls: Array<{ url: string; body: any }> = [];
let graphFail = false;
/** GET responses for the past-DM import, keyed by URL path fragment. */
let graphGets: Record<string, unknown> = {};
vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  const ax = actual.default as any;
  const realPost = ax.post.bind(ax);
  const realGet = ax.get.bind(ax);
  ax.get = (url: string, ...rest: unknown[]) => {
    if (!String(url).includes("graph.facebook.com")) return realGet(url, ...rest);
    const key = Object.keys(graphGets).find((k) => String(url).endsWith(k));
    return Promise.resolve(key ? { status: 200, data: graphGets[key] } : { status: 404, data: { error: { message: "not mocked" } } });
  };
  ax.post = (url: string, body: unknown, ...rest: unknown[]) => {
    if (!String(url).includes("graph.facebook.com")) return realPost(url, body, ...rest);
    graphCalls.push({ url: String(url), body });
    return Promise.resolve(
      graphFail
        ? { status: 400, data: { error: { code: 10, message: "outside allowed window" } } }
        : { status: 200, data: { recipient_id: (body as any)?.recipient?.id, message_id: `m_out_${graphCalls.length}` } },
    );
  };
  return actual;
});

import request from "supertest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  createServer,
  createSession,
  executeAdminAiTool,
  importMetaDmHistory,
  guessSocialMessageLang,
  metaReplyWindow,
  parseMetaMessagingWebhook,
  verifyMetaSignature,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const SECRET = "vitest-meta-app-secret";
const CESAR = 90001; // release manager: sees every social sender
const RUN = `sdm${Date.now()}`;
const PAGE = `page_${RUN}`;
const IG = `ig_${RUN}`;
const user = (k: string) => `${RUN}_${k}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let clientId = 0;
const saved = {
  flag: process.env.SOCIAL_DM_INBOX_ENABLED,
  secret: process.env.META_APP_SECRET,
  page: process.env.META_PAGE_ACCESS_TOKEN,
  verify: process.env.META_WEBHOOK_VERIFY_TOKEN,
  pageId: process.env.META_PAGE_ID,
  igId: process.env.META_IG_ACCOUNT_ID,
};

const sign = (raw: string, secret = SECRET) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
const dm = (object: "page" | "instagram", sender: string, text: string, mid: string, opts: { echo?: boolean; account?: string } = {}) => ({
  object,
  entry: [
    {
      id: opts.account ?? (object === "page" ? PAGE : IG),
      time: Date.now(),
      messaging: [
        {
          sender: { id: opts.echo ? (object === "page" ? PAGE : IG) : sender },
          recipient: { id: opts.echo ? sender : object === "page" ? PAGE : IG },
          timestamp: Date.now(),
          message: { mid, text, ...(opts.echo ? { is_echo: true } : {}) },
        },
      ],
    },
  ],
});
const post = (payload: unknown, sig?: string) => {
  const raw = JSON.stringify(payload);
  return request(app)
    .post("/api/webhooks/meta/messaging")
    .set("content-type", "application/json")
    .set("x-hub-signature-256", sig ?? sign(raw))
    .send(raw);
};
const unknownFor = async (userId: string) =>
  (await pool.query<RowDataPacket[]>(`SELECT * FROM conversation_unknown_contacts WHERE social_user_id = ?`, [userId]))[0][0];
const messagesFor = async (userId: string) =>
  (
    await pool.query<RowDataPacket[]>(
      `SELECT m.direction, m.channel, m.body, m.provider_message_id, m.metadata_json, cv.channel AS thread_channel, cv.client_id, cv.assigned_admin_id
       FROM conversation_messages m JOIN conversations cv ON cv.id = m.conversation_id
       WHERE m.from_address = ? OR m.to_address = ? ORDER BY m.id`,
      [userId, userId],
    )
  )[0];
const send = (body: Record<string, unknown>) =>
  request(app).post("/api/admin/conversations/send").set("Authorization", `Bearer ${token}`).send(body);

beforeAll(async () => {
  process.env.SOCIAL_DM_INBOX_ENABLED = "1";
  process.env.META_APP_SECRET = SECRET;
  process.env.META_PAGE_ACCESS_TOKEN = "vitest-page-token";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "vitest-verify";
  process.env.META_PAGE_ID = PAGE;
  process.env.META_IG_ACCOUNT_ID = IG;
  pool = createIntegrationTestPool();
  app = createServer();
  const [[a]] = await pool.query<RowDataPacket[]>(`SELECT email FROM admins WHERE id = ?`, [CESAR]);
  token = await createSession("admin", CESAR, String(a.email), "127.0.0.1", `vitest-${RUN}`);
  const [c] = await pool.query<any>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Social', ?, ?, 'prospect', 'prospect')`,
    [RUN, `${RUN}@example.test`],
  );
  clientId = c.insertId;
}, 60_000);

afterAll(async () => {
  const [u] = await pool.query<RowDataPacket[]>(`SELECT id FROM conversation_unknown_contacts WHERE social_user_id LIKE ?`, [`${RUN}%`]);
  const ids = u.map((r) => Number(r.id));
  const [cv] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM conversations WHERE ${ids.length ? "unknown_contact_id IN (?) OR " : ""}client_id = ?`,
    ids.length ? [ids, clientId] : [clientId],
  );
  const convIds = cv.map((r) => Number(r.id));
  if (convIds.length) {
    await pool.query(`DELETE FROM conversation_messages WHERE conversation_id IN (?)`, [convIds]);
    await pool.query(`DELETE FROM conversations WHERE id IN (?)`, [convIds]);
  }
  if (ids.length) {
    // Only this run's alerts: a bare "%unknown=%" would delete real staff notifications too.
    for (const id of ids) {
      await pool.query(`DELETE FROM admin_notifications WHERE link_url LIKE ?`, [`%unknown=${id}&%`]).catch(() => null);
      await pool.query(`DELETE FROM admin_notifications WHERE link_url LIKE ?`, [`%unknown=${id}`]).catch(() => null);
    }
    await pool.query(`DELETE FROM conversation_unknown_contacts WHERE id IN (?)`, [ids]);
  }
  await cleanupIntegrationTestClients(pool, { runId: RUN, clientIds: [clientId] });
  for (const [k, v] of Object.entries({
    SOCIAL_DM_INBOX_ENABLED: saved.flag,
    META_APP_SECRET: saved.secret,
    META_PAGE_ACCESS_TOKEN: saved.page,
    META_WEBHOOK_VERIFY_TOKEN: saved.verify,
    META_PAGE_ID: saved.pageId,
    META_IG_ACCOUNT_ID: saved.igId,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool.end();
}, 60_000);

describe("Meta DM helpers", () => {
  it("signature: exact HMAC only, constant-time, rejects anything else", () => {
    const raw = '{"object":"page"}';
    expect(verifyMetaSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, sign(raw, "other"), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw + " ", sign(raw), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha1=abc", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw), "")).toBe(false);
  });

  it("parser: Messenger + Instagram messages, echoes flagged, reads / deliveries / deletes / empty dropped", () => {
    expect(parseMetaMessagingWebhook(dm("page", "u1", "hi", "m1"))).toMatchObject([{ platform: "messenger", userId: "u1", text: "hi", isEcho: false, accountId: PAGE }]);
    expect(parseMetaMessagingWebhook(dm("instagram", "u2", "hola", "m2"))[0]).toMatchObject({ platform: "instagram", userId: "u2" });
    expect(parseMetaMessagingWebhook(dm("page", "u3", "from page", "m3", { echo: true }))[0]).toMatchObject({ userId: "u3", isEcho: true });
    const noise = {
      object: "page",
      entry: [{ id: PAGE, messaging: [
        { sender: { id: "u4" }, recipient: { id: PAGE }, read: { watermark: 1 } },
        { sender: { id: "u4" }, recipient: { id: PAGE }, delivery: { mids: ["x"] } },
        { sender: { id: "u4" }, recipient: { id: PAGE }, message: { mid: "m5", is_deleted: true } },
        { sender: { id: "u4" }, recipient: { id: PAGE }, message: { mid: "m6" } },
        { sender: { id: PAGE }, recipient: { id: PAGE }, message: { mid: "m7", text: "self" } },
      ] }],
    };
    expect(parseMetaMessagingWebhook(noise)).toEqual([]);
    expect(parseMetaMessagingWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseMetaMessagingWebhook(null)).toEqual([]);
    const img = { object: "page", entry: [{ id: PAGE, messaging: [{ sender: { id: "u8" }, recipient: { id: PAGE }, message: { mid: "m8", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] } }] }] };
    expect(parseMetaMessagingWebhook(img)[0]).toMatchObject({ text: "", attachments: [{ type: "image", url: "https://x/y.jpg" }] });
  });

  it("language guess and Meta reply window", () => {
    expect(guessSocialMessageLang("Hola, quiero información de crédito")).toBe("es");
    expect(guessSocialMessageLang("¿Cuánto cuesta?")).toBe("es");
    expect(guessSocialMessageLang("Hi, how much is the program?")).toBe("en");
    const now = Date.now();
    expect(metaReplyWindow(new Date(now - 2 * 3600_000), now)).toBe("standard");
    expect(metaReplyWindow(new Date(now - 3 * 24 * 3600_000), now)).toBe("human_agent");
    expect(metaReplyWindow(new Date(now - 8 * 24 * 3600_000), now)).toBe("closed");
    expect(metaReplyWindow(null, now)).toBe("closed");
  });
});

describe("Meta DM webhook + inbox", () => {
  it("verification handshake: right token echoes the challenge, wrong token is 403", async () => {
    const ok = await request(app).get("/api/webhooks/meta/messaging").query({ "hub.mode": "subscribe", "hub.verify_token": "vitest-verify", "hub.challenge": "c123" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("c123");
    const bad = await request(app).get("/api/webhooks/meta/messaging").query({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "c123" });
    expect(bad.status).toBe(403);
  });

  it("unsigned or wrongly signed posts are rejected and save nothing", async () => {
    const res = await post(dm("page", user("forged"), "hi", `${RUN}_forged`), "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
    expect(await unknownFor(user("forged"))).toBeUndefined();
  });

  it("new Messenger sender → social unknown thread on channel messenger; retry is a duplicate", async () => {
    const payload = dm("page", user("fb"), "Hi, how much is credit repair?", `${RUN}_m1`);
    const res = await post(payload);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(["saved"]);
    const u = await unknownFor(user("fb"));
    expect(u).toMatchObject({ social_platform: "messenger", phone_e164: null, social_page_id: PAGE, status: "open", unread_count: 1 });
    expect(u.social_last_inbound_at).toBeTruthy();
    const msgs = await messagesFor(user("fb"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "inbound", channel: "messenger", thread_channel: "messenger", body: "Hi, how much is credit repair?" });
    expect(msgs[0].assigned_admin_id).toBeTruthy();
    const again = await post(payload);
    expect(again.body.results).toEqual(["duplicate"]);
    expect(await messagesFor(user("fb"))).toHaveLength(1);
  });

  it("Instagram sender in Spanish goes to an Instagram thread; English and Spanish route by language owner", async () => {
    await post(dm("instagram", user("ig"), "Hola, quiero información de crédito por favor", `${RUN}_i1`));
    const es = (await messagesFor(user("ig")))[0];
    expect(es).toMatchObject({ channel: "instagram", thread_channel: "instagram" });
    const en = (await messagesFor(user("fb")))[0];
    const [[owners]] = await pool.query<RowDataPacket[]>(
      `SELECT (SELECT id FROM admins WHERE language_owner_for = 'es' AND status = 'active' LIMIT 1) es_owner,
              (SELECT id FROM admins WHERE language_owner_for = 'en' AND status = 'active' LIMIT 1) en_owner`,
    );
    if (owners.es_owner) expect(Number(es.assigned_admin_id)).toBe(Number(owners.es_owner));
    if (owners.en_owner) expect(Number(en.assigned_admin_id)).toBe(Number(owners.en_owner));
  });

  it("Page echo (reply sent from Meta's own apps) is saved as outbound; echo for a stranger is skipped", async () => {
    const r1 = await post(dm("page", user("fb"), "Sent from Business Suite", `${RUN}_e1`, { echo: true }));
    expect(r1.body.results).toEqual(["echo_saved"]);
    const r2 = await post(dm("page", user("nobody"), "x", `${RUN}_e2`, { echo: true }));
    expect(r2.body.results).toEqual(["echo_skipped"]);
    const out = (await messagesFor(user("fb"))).filter((m) => m.direction === "outbound");
    expect(out[0]).toMatchObject({ body: "Sent from Business Suite", channel: "messenger" });
  });

  it("inbox reply: standard within 24h, HUMAN_AGENT tag at 3 days, refused after 7 days; wrong platform refused", async () => {
    const u = await unknownFor(user("fb"));
    graphCalls.length = 0;
    const ok = await send({ unknown_contact_id: u.id, channel: "messenger", body: "Our program starts at $99" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, provider_status: "sent" });
    expect(graphCalls[0].url).toContain(`/${PAGE}/messages`);
    expect(graphCalls[0].body).toMatchObject({ recipient: { id: user("fb") }, message: { text: "Our program starts at $99" }, messaging_type: "RESPONSE" });

    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() - INTERVAL 3 DAY WHERE id = ?`, [u.id]);
    await send({ unknown_contact_id: u.id, channel: "messenger", body: "Following up" });
    expect(graphCalls[1].body).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });

    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() - INTERVAL 8 DAY WHERE id = ?`, [u.id]);
    const late = await send({ unknown_contact_id: u.id, channel: "messenger", body: "Too late" });
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(String(late.body.error)).toMatch(/7 days/);
    expect(graphCalls).toHaveLength(2);

    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() WHERE id = ?`, [u.id]);
    const wrong = await send({ unknown_contact_id: u.id, channel: "instagram", body: "x" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    graphFail = true;
    const failed = await send({ unknown_contact_id: u.id, channel: "messenger", body: "Will fail" });
    graphFail = false;
    expect(failed.body).toMatchObject({ ok: false, provider_status: "failed" });
    expect(String(failed.body.error)).toMatch(/Meta send failed \(10\)/);
  });

  it("Social tab lists social senders; the SMS tab does not", async () => {
    const social = await request(app).get("/api/admin/conversations").query({ hub: "social", view: "all", limit: 100 }).set("Authorization", `Bearer ${token}`);
    expect(social.status).toBe(200);
    const fbId = Number((await unknownFor(user("fb"))).id);
    const row = social.body.contacts.find((c: any) => c.kind === "unknown" && c.unknown_contact_id === fbId);
    expect(row).toMatchObject({ social_platform: "messenger", channels: ["messenger"] });
    const sms = await request(app).get("/api/admin/conversations").query({ view: "all", limit: 100 }).set("Authorization", `Bearer ${token}`);
    expect(sms.body.contacts.some((c: any) => c.kind === "unknown" && c.social_platform)).toBe(false);
  });

  it("Social tab: platform filter, @username search and live reply window on each row", async () => {
    const q = (extra: Record<string, unknown>) =>
      request(app).get("/api/admin/conversations").query({ hub: "social", view: "all", limit: 100, ...extra }).set("Authorization", `Bearer ${token}`);
    const fbId = Number((await unknownFor(user("fb"))).id);
    const igId = Number((await unknownFor(user("ig"))).id);
    const ig = await q({ platform: "instagram" });
    const igIds = ig.body.contacts.filter((c: any) => c.kind === "unknown").map((c: any) => c.unknown_contact_id);
    expect(igIds).toContain(igId);
    expect(igIds).not.toContain(fbId);
    const fbRow = (await q({ platform: "messenger" })).body.contacts.find((c: any) => c.unknown_contact_id === fbId);
    expect(fbRow).toMatchObject({ social_platform: "messenger", social_reply_window: "standard" });
    expect(Date.parse(fbRow.social_window_ends_at)).toBeGreaterThan(Date.now());
    await pool.query(`UPDATE conversation_unknown_contacts SET social_username = ? WHERE id = ?`, [`${RUN}_handle`, igId]);
    const found = await q({ q: `${RUN}_handle` });
    expect(found.body.contacts.map((c: any) => c.unknown_contact_id)).toContain(igId);
  });

  it("MCP: list_social_inbox / get_social_thread read; send_social_reply dry-runs, sends on CONFIRM, refuses a closed window", async () => {
    const run = (name: string, args: Record<string, unknown>) => executeAdminAiTool(name, args, { adminId: CESAR }) as Promise<any>;
    const fbId = Number((await unknownFor(user("fb"))).id);
    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() WHERE id = ?`, [fbId]);
    const list = await run("list_social_inbox", { platform: "messenger", view: "all", limit: 50 });
    const thread = list.data.threads.find((t: any) => t.unknown_contact_id === fbId);
    expect(thread).toMatchObject({ platform: "messenger", reply_window: "standard" });

    const read = await run("get_social_thread", { conversation_id: thread.conversation_id });
    expect(read.ok).toBe(true);
    expect(read.data.messages.length).toBeGreaterThan(0);

    graphCalls.length = 0;
    const dry = await run("send_social_reply", { conversation_id: thread.conversation_id, body: "Hi from MCP" });
    expect(dry.data).toMatchObject({ dry_run: true, preview: { platform: "messenger", reply_window: "standard", body: "Hi from MCP" } });
    expect(graphCalls).toHaveLength(0);
    const sent = await run("send_social_reply", { conversation_id: thread.conversation_id, body: "Hi from MCP", confirm: true, confirm_phrase: "CONFIRM" });
    expect(sent).toMatchObject({ ok: true, data: { sent: true } });
    expect(graphCalls[0].body).toMatchObject({ recipient: { id: user("fb") }, message: { text: "Hi from MCP" } });

    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() - INTERVAL 8 DAY WHERE id = ?`, [fbId]);
    const late = await run("send_social_reply", { conversation_id: thread.conversation_id, body: "Too late", confirm: true, confirm_phrase: "CONFIRM" });
    expect(late).toMatchObject({ ok: false, error: "reply_window_closed" });
    expect(graphCalls).toHaveLength(1);
    await pool.query(`UPDATE conversation_unknown_contacts SET social_last_inbound_at = NOW() WHERE id = ?`, [fbId]);

    const missing = await run("get_social_thread", { conversation_id: 999999999 });
    expect(missing).toMatchObject({ ok: false, error: "not_found" });
  });

  it("MCP: assign_conversation / set_conversation_status take an Instagram sender's unknown_contact_id", async () => {
    const run = (name: string, args: Record<string, unknown>) => executeAdminAiTool(name, args, { adminId: CESAR }) as Promise<any>;
    const igId = Number((await unknownFor(user("ig"))).id);
    const dry = await run("assign_conversation", { unknown_contact_id: igId, admin_id: CESAR });
    expect(dry).toMatchObject({ ok: true, dry_run: true });
    const done = await run("assign_conversation", { unknown_contact_id: igId, admin_id: CESAR, confirm: true, confirm_phrase: "CONFIRM" });
    expect(done).toMatchObject({ ok: true, data: { assigned_admin_id: CESAR } });
    const [[cv]] = await pool.query<RowDataPacket[]>(`SELECT assigned_admin_id FROM conversations WHERE unknown_contact_id = ? LIMIT 1`, [igId]);
    expect(Number(cv.assigned_admin_id)).toBe(CESAR);
    const closed = await run("set_conversation_status", { unknown_contact_id: igId, status: "closed", confirm: true, confirm_phrase: "CONFIRM" });
    expect(closed).toMatchObject({ ok: true, data: { status: "closed" } });
    await run("set_conversation_status", { unknown_contact_id: igId, status: "open", confirm: true, confirm_phrase: "CONFIRM" });
  });

  it("inbox filters combine: mine / unassigned / unread / unknown only (AND)", async () => {
    const q = (extra: Record<string, string>) =>
      request(app).get("/api/admin/conversations").query({ hub: "social", view: "all", limit: 100, ...extra }).set("Authorization", `Bearer ${token}`);
    const ids = (r: any) => r.body.contacts.map((c: any) => c.unknown_contact_id).filter(Boolean);
    const fbId = Number((await unknownFor(user("fb"))).id);
    const igId = Number((await unknownFor(user("ig"))).id);
    await pool.query(`UPDATE conversations SET assigned_admin_id = ? WHERE unknown_contact_id = ?`, [CESAR, igId]);
    await pool.query(`UPDATE conversations SET assigned_admin_id = NULL WHERE unknown_contact_id = ?`, [fbId]);
    await pool.query(`UPDATE conversation_unknown_contacts SET unread_count = 2 WHERE id = ?`, [igId]);
    await pool.query(`UPDATE conversation_unknown_contacts SET unread_count = 0 WHERE id = ?`, [fbId]);

    const mine = ids(await q({ mine: "1" }));
    expect(mine).toContain(igId);
    expect(mine).not.toContain(fbId);
    const unassigned = ids(await q({ unassigned: "1" }));
    expect(unassigned).toContain(fbId);
    expect(unassigned).not.toContain(igId);
    const unread = ids(await q({ unread: "1" }));
    expect(unread).toContain(igId);
    expect(unread).not.toContain(fbId);
    expect(ids(await q({ unread: "1", unassigned: "1" }))).not.toContain(igId); // AND, not OR
    const unknownOnly = await q({ unknown: "1" });
    expect(unknownOnly.body.contacts.every((c: any) => c.kind === "unknown")).toBe(true);
    expect(ids(unknownOnly)).toEqual(expect.arrayContaining([fbId, igId]));
    // Unread badge source: the same endpoint with unread=1 reports the total.
    expect((await q({ unread: "1", limit: "1" })).body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it("after linking to a client, the next DM lands on the client's record and replies go to them", async () => {
    const u = await unknownFor(user("fb"));
    const link = await request(app)
      .post(`/api/admin/conversations/unknown/${u.id}/link`)
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId });
    expect(link.status).toBe(200);
    expect(await unknownFor(user("fb"))).toMatchObject({ status: "linked", linked_client_id: clientId });
    const res = await post(dm("page", user("fb"), "It's me again", `${RUN}_m2`));
    expect(res.body.results).toEqual(["saved"]);
    const last = (await messagesFor(user("fb"))).filter((m) => m.direction === "inbound").pop()!;
    expect(last).toMatchObject({ client_id: clientId, thread_channel: "messenger", body: "It's me again" });
    graphCalls.length = 0;
    const reply = await send({ client_id: clientId, channel: "messenger", body: "Welcome back" });
    expect(reply.body).toMatchObject({ ok: true });
    expect(graphCalls[0].body.recipient.id).toBe(user("fb"));
  });

  it("past DM import: closed + read threads with real timestamps, no alerts, idempotent, old messages skipped", async () => {
    const person = user("hist");
    const day = 24 * 3600_000;
    const recent = new Date(Date.now() - 10 * day).toISOString();
    graphGets = {
      [`/${PAGE}/conversations`]: { data: [{ id: `t_${RUN}`, updated_time: recent }] },
      [`/t_${RUN}`]: {
        participants: { data: [{ id: person, name: "History Person" }, { id: PAGE, name: "Optimum Financial" }] },
        messages: {
          data: [
            { id: `${RUN}_h3`, created_time: recent, message: "Thanks, we'll call you", from: { id: PAGE } },
            { id: `${RUN}_h2`, created_time: new Date(Date.now() - 11 * day).toISOString(), message: "Can you help with my credit?", from: { id: person } },
            { id: `${RUN}_h1`, created_time: new Date(Date.now() - 200 * day).toISOString(), message: "too old", from: { id: person } },
          ],
        },
      },
    };
    const dry = await importMetaDmHistory({ days: 90, dryRun: true, platforms: ["messenger"] });
    expect(dry).toMatchObject({ dry_run: true, threads_new: 1, messages_inserted: 2 });
    expect(await unknownFor(person)).toBeUndefined();

    const run = await importMetaDmHistory({ days: 90, dryRun: false, platforms: ["messenger"] });
    expect(run).toMatchObject({ threads_new: 1, messages_inserted: 2, messages_duplicate: 0 });
    const u = await unknownFor(person);
    expect(u).toMatchObject({ display_name: "History Person", social_platform: "messenger", unread_count: 0 });
    const msgs = await messagesFor(person);
    expect(msgs.map((m) => [m.direction, m.body])).toEqual([
      ["inbound", "Can you help with my credit?"],
      ["outbound", "Thanks, we'll call you"],
    ]);
    const [[cv]] = await pool.query<RowDataPacket[]>(`SELECT status, unread_count, last_message_at FROM conversations WHERE unknown_contact_id = ?`, [u.id]);
    expect(cv).toMatchObject({ status: "closed", unread_count: 0 });
    expect(Math.abs(new Date(cv.last_message_at).getTime() - Date.parse(recent))).toBeLessThan(2000);
    const [[alerts]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM admin_notifications WHERE link_url LIKE ?`, [`%unknown=${u.id}&%`]);
    expect(Number(alerts.n)).toBe(0);

    const again = await importMetaDmHistory({ days: 90, dryRun: false, platforms: ["messenger"] });
    expect(again).toMatchObject({ threads_existing: 1, messages_inserted: 0, messages_duplicate: 2 });
    graphGets = {};
  });

  it("feature off → 503 and nothing saved", async () => {
    process.env.SOCIAL_DM_INBOX_ENABLED = "0";
    const res = await post(dm("page", user("off"), "hi", `${RUN}_off`));
    process.env.SOCIAL_DM_INBOX_ENABLED = "1";
    expect(res.status).toBe(503);
    expect(await unknownFor(user("off"))).toBeUndefined();
  });
});
