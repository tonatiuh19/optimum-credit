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
vi.mock("axios", async (orig) => {
  const actual = await orig<typeof import("axios")>();
  const ax = actual.default as any;
  const realPost = ax.post.bind(ax);
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
    await pool.query(`DELETE FROM admin_notifications WHERE link_url LIKE ?`, [`%unknown=%`]).catch(() => null);
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

  it("feature off → 503 and nothing saved", async () => {
    process.env.SOCIAL_DM_INBOX_ENABLED = "0";
    const res = await post(dm("page", user("off"), "hi", `${RUN}_off`));
    process.env.SOCIAL_DM_INBOX_ENABLED = "1";
    expect(res.status).toBe(503);
    expect(await unknownFor(user("off"))).toBeUndefined();
  });
});
