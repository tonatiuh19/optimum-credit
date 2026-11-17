/**
 * Nov 17, 2026: browser softphone errors (e.g. Twilio 53405 when answering on a phone) and busy
 * rejections are saved with device context. Staff with Conversations access only. Test rows only.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, normalizeVoiceClientEvent } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const SID = `CA${"ab12".repeat(8)}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let adminId = 0;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148 Safari/604.1 vitest-voice-event";

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [admins] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.email FROM admins a JOIN admin_phone_numbers p ON p.assigned_admin_id = a.id AND p.is_active = 1
     WHERE a.status = 'active' ORDER BY a.id ASC LIMIT 1`,
  );
  adminId = Number(admins[0].id);
  token = await createSession("admin", adminId, String(admins[0].email), "127.0.0.1", "vitest-voice-event");
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM voice_client_events WHERE user_agent LIKE '%vitest-voice-event%' OR call_sid = ?`, [SID]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-voice-event'`).catch(() => null);
  await pool.end();
}, 60_000);

const post = (body: unknown, auth = true) => {
  const r = request(app).post("/api/voice/client-event").set("User-Agent", UA);
  return (auth ? r.set("Authorization", `Bearer ${token}`) : r).send(body as object);
};

describe("POST /api/voice/client-event", () => {
  it("saves a 53405 on answering, with the device context and the user agent", async () => {
    const res = await post({
      direction: "incoming", event: "error", call_sid: SID, error_code: 53405,
      error_message: "ConnectionError (53405): media connection fails", seconds_since_answer: 2.345,
      is_mobile: true, platform: "iPhone", browser: "Safari", network_type: null, visibility: "visible", online: true, mic_permission: "granted",
    });
    expect(res.status).toBe(201);
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT * FROM voice_client_events WHERE call_sid = ? ORDER BY id DESC LIMIT 1`, [SID]);
    expect(row).toMatchObject({ admin_id: adminId, direction: "incoming", event: "error", error_code: 53405, is_mobile: 1, platform: "iPhone", visibility: "visible", online: 1, mic_permission: "granted" });
    expect(Number(row.seconds_since_answer)).toBe(2.35);
    expect(String(row.user_agent)).toContain("vitest-voice-event");
  });

  it("refuses no login (401) and bad direction / event (400)", async () => {
    expect((await post({ direction: "incoming", event: "error" }, false)).status).toBe(401);
    expect((await post({ direction: "sideways", event: "error" })).status).toBe(400);
    expect((await post({ direction: "incoming", event: "explode" })).status).toBe(400);
  });

  it("records a busy rejection", async () => {
    expect((await post({ direction: "incoming", event: "rejected_busy", call_sid: SID, error_message: "staff member already on a call" })).status).toBe(201);
  });
});

describe("normalizeVoiceClientEvent", () => {
  it("drops a malformed call SID, clamps and trims, keeps booleans only when given", () => {
    const r = normalizeVoiceClientEvent({ direction: "device", event: "error", call_sid: "not-a-sid", seconds_since_answer: -4, error_message: "x".repeat(900), is_mobile: "yes", error_code: "53405" });
    expect(r).toMatchObject({ call_sid: null, seconds_since_answer: 0, is_mobile: null, error_code: 53405 });
    expect((r as { error_message: string }).error_message).toHaveLength(500);
    expect(normalizeVoiceClientEvent(null)).toEqual({ error: "direction must be incoming, outgoing or device" });
  });
});
