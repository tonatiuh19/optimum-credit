/**
 * Holiday greetings (Nov 17, 2026) — routes, approval rules, MCP tools, STOP list. Uses its own row for
 * year 2099 (never due, never sent); the cron sender is off in tests. No real texts are sent.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, executeAdminAiTool, isSmsOptedOut, recordSmsOptKeyword } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const CESAR = 90001; // approver
const LECCA = 150002; // not an approver
const FAKE_PHONE = `+1555${String(Date.now()).slice(-7)}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let gid = 0;
const tokens: Record<number, string> = {};

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  await pool.query(`DELETE FROM holiday_greetings WHERE year = 2099`);
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO holiday_greetings (holiday_key, year, send_at, status, body_en, body_es) VALUES ('thanksgiving', 2099, '2099-11-26 09:00:00', 'draft', 'Happy Thanksgiving, {{first_name}}!', '¡Feliz Día de Acción de Gracias, {{first_name}}!')`,
  );
  gid = r.insertId;
  for (const id of [CESAR, LECCA]) tokens[id] = await createSession("admin", id, `hg-${id}@example.test`, "127.0.0.1", "vitest-holiday");
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM holiday_greetings WHERE year = 2099`);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'holiday_greeting.approved' AND entity_id = ?`, [gid]);
  await pool.query(`DELETE FROM sms_opt_outs WHERE phone = ?`, [FAKE_PHONE]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-holiday'`).catch(() => null);
  await pool.end();
}, 60_000);

const as = (admin: number) => ({
  get: (u: string) => request(app).get(u).set("Authorization", `Bearer ${tokens[admin]}`),
  put: (u: string, b: object) => request(app).put(u).set("Authorization", `Bearer ${tokens[admin]}`).send(b),
  post: (u: string, b: object = {}) => request(app).post(u).set("Authorization", `Bearer ${tokens[admin]}`).send(b),
});
const status = async () => String((await pool.query<RowDataPacket[]>(`SELECT status FROM holiday_greetings WHERE id = ?`, [gid]))[0][0].status);

describe("holiday greetings — routes", () => {
  it("list: creates this year's drafts and says who can approve; needs a login", async () => {
    expect((await request(app).get("/api/admin/holiday-greetings")).status).toBe(401);
    const res = await as(CESAR).get("/api/admin/holiday-greetings");
    expect(res.status).toBe(200);
    expect(res.body.can_approve).toBe(true);
    expect(res.body.stop_footer.en).toMatch(/STOP/);
    expect((await as(LECCA).get("/api/admin/holiday-greetings")).body.can_approve).toBe(false);
  });

  it("audience preview: counts, skipped reasons and a rendered text with the STOP line", async () => {
    const res = await as(CESAR).get(`/api/admin/holiday-greetings/${gid}/audience`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("preview");
    expect(res.body.count).toBeGreaterThanOrEqual(0);
    expect(Object.keys(res.body.skipped).sort()).toEqual(["no_phone", "no_recent_text", "no_sender_line", "opted_out"]);
    expect(res.body.preview.en).toMatch(/Reply STOP to opt out\.$/);
    expect(res.body.preview.es).toMatch(/Responde STOP/);
    // Test clients never receive holiday texts.
    const [[t]] = await pool.query<RowDataPacket[]>(`SELECT GROUP_CONCAT(id) ids FROM clients WHERE email LIKE '%@example.test'`);
    const testIds = new Set(String(t.ids ?? "").split(",").filter(Boolean).map(Number));
    expect(res.body.recipients.some((r: { client_id: number }) => testIds.has(r.client_id))).toBe(false);
  });

  it("only Cesar / Alex approve; an approved text edited goes back to draft; skip / restore", async () => {
    expect((await as(LECCA).post(`/api/admin/holiday-greetings/${gid}/approve`)).status).toBe(403);
    expect(await status()).toBe("draft");
    const ok = await as(CESAR).post(`/api/admin/holiday-greetings/${gid}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.greeting).toMatchObject({ status: "approved", approved_by: expect.any(String) });
    expect((await as(CESAR).post(`/api/admin/holiday-greetings/${gid}/approve`)).status).toBe(409);
    // Anyone with access may edit; the edit drops the approval.
    const edit = await as(LECCA).put(`/api/admin/holiday-greetings/${gid}`, { body_en: "Happy Thanksgiving, {{first_name}}! 🦃", send_time: "10:15" });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ needs_approval: true, greeting: { status: "draft", send_at: "2099-11-26 10:15:00" } });
    expect((await as(LECCA).put(`/api/admin/holiday-greetings/${gid}`, { send_time: "21:00" })).status).toBe(400);
    expect((await as(LECCA).post(`/api/admin/holiday-greetings/${gid}/skip`)).status).toBe(403);
    expect((await as(CESAR).post(`/api/admin/holiday-greetings/${gid}/skip`)).status).toBe(200);
    expect(await status()).toBe("skipped");
    expect((await as(CESAR).put(`/api/admin/holiday-greetings/${gid}`, { body_en: "x" })).status).toBe(409);
    expect((await as(CESAR).post(`/api/admin/holiday-greetings/${gid}/restore`)).status).toBe(200);
    expect(await status()).toBe("draft");
  });

  it("a past send time cannot be approved", async () => {
    await pool.query(`UPDATE holiday_greetings SET send_at = '2000-01-01 09:00:00' WHERE id = ?`, [gid]);
    expect((await as(CESAR).post(`/api/admin/holiday-greetings/${gid}/approve`)).status).toBe(409);
    await pool.query(`UPDATE holiday_greetings SET send_at = '2099-11-26 09:00:00' WHERE id = ?`, [gid]);
  });

  it("the calendar lists holidays in the range", async () => {
    const res = await as(CESAR).get(`/api/admin/calendar?from=2099-11-01&to=2099-11-30`);
    expect(res.status).toBe(200);
    expect(res.body.holiday_greetings.map((h: { id: number }) => h.id)).toContain(gid);
  });
});

describe("holiday greetings — MCP", () => {
  it("list / get are read tools; approve is dry-run first and Cesar-only", async () => {
    const list = (await executeAdminAiTool("list_holiday_greetings", {}, { adminId: CESAR })) as any;
    expect(list.ok).toBe(true);
    const get = (await executeAdminAiTool("get_holiday_greeting", { greeting_id: gid }, { adminId: CESAR })) as any;
    expect(get.data.preview.en).toMatch(/STOP/);
    const dry = (await executeAdminAiTool("approve_holiday_greeting", { greeting_id: gid }, { adminId: CESAR })) as any;
    expect(dry).toMatchObject({ ok: true, dry_run: true, preview: { you_can: "approve" } });
    expect(await status()).toBe("draft");
    const lecca = (await executeAdminAiTool("approve_holiday_greeting", { greeting_id: gid, confirm: true, confirm_phrase: "CONFIRM" }, { adminId: LECCA })) as any;
    expect(lecca.ok).toBe(false);
    expect(await status()).toBe("draft");
    const yes = (await executeAdminAiTool("approve_holiday_greeting", { greeting_id: gid, confirm: true, confirm_phrase: "CONFIRM" }, { adminId: CESAR })) as any;
    expect(yes.ok).toBe(true);
    expect(await status()).toBe("approved");
    const back = (await executeAdminAiTool("set_holiday_greeting_status", { greeting_id: gid, action: "unapprove", confirm: true, confirm_phrase: "CONFIRM" }, { adminId: CESAR })) as any;
    expect(back.ok).toBe(true);
    expect(await status()).toBe("draft");
  });

  it("update validates before the dry run", async () => {
    const bad = (await executeAdminAiTool("update_holiday_greeting", { greeting_id: gid, send_time: "06:00" }, { adminId: CESAR })) as any;
    expect(bad).toMatchObject({ ok: false, error: "invalid_args" });
  });
});

describe("STOP list", () => {
  it("STOP adds the number, START removes it; other words do nothing", async () => {
    expect(await recordSmsOptKeyword(FAKE_PHONE, "hello")).toBeNull();
    expect(await isSmsOptedOut(FAKE_PHONE)).toBe(false);
    expect(await recordSmsOptKeyword(FAKE_PHONE, " stop ")).toBe("stop");
    expect(await isSmsOptedOut(FAKE_PHONE.replace("+1", ""))).toBe(true);
    expect(await recordSmsOptKeyword(FAKE_PHONE, "BAJA")).toBe("stop"); // twice is fine
    expect(await recordSmsOptKeyword(FAKE_PHONE, "START")).toBe("start");
    expect(await isSmsOptedOut(FAKE_PHONE)).toBe(false);
  });
});
