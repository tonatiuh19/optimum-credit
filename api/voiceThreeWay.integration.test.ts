/**
 * Three-way calls — normal calls unchanged; "Add caller" sessions move the
 * other leg into the conference at Dial end. Twilio is not configured in
 * tests, so the REST side (/start) is covered by validation only.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import {
  createServer,
  createSession,
  normalizeThreeWayNumber,
  parseThreeWayPresets,
  sanitizeThreeWayDigits,
  threeWayConferenceTwiml,
} from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const RUN = `3w${Date.now()}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let agentId = 0;
let token = "";
let phoneId = 0;
const sessionIds: number[] = [];

describe("three-way call helpers", () => {
  it("accepts US numbers only", () => {
    expect(normalizeThreeWayNumber("(949) 736-5644")).toBe("+19497365644");
    expect(normalizeThreeWayNumber("+1 877 555 0100")).toBe("+18775550100");
    expect(normalizeThreeWayNumber("+52 33 1234 5678")).toBeNull();
    expect(normalizeThreeWayNumber("123")).toBeNull();
  });
  it("sanitizes keypad digits", () => {
    expect(sanitizeThreeWayDigits("1 2#")).toBe("12#");
    expect(sanitizeThreeWayDigits("1;rm")).toBeNull();
  });
  it("parses presets safely", () => {
    expect(
      parseThreeWayPresets({
        VOICE_THREE_WAY_PRESETS: JSON.stringify([
          { label: "SmartCredit", number: "877-555-0100" },
          { label: "Bad", number: "+52 1" },
        ]),
      }),
    ).toEqual([{ label: "SmartCredit", number: "+18775550100" }]);
    expect(parseThreeWayPresets({ VOICE_THREE_WAY_PRESETS: "not json" })).toEqual([]);
  });
  it("builds a recorded conference join", () => {
    const xml = threeWayConferenceTwiml({ name: "ofg3w_CAx", baseUrl: "https://x", endConferenceOnExit: true });
    expect(xml).toContain("<Conference");
    expect(xml).toContain("ofg3w_CAx");
    expect(xml).toContain('record="record-from-start"');
    expect(xml).toContain("/api/voice/three-way/recording-status");
  });
});

describe("three-way call routes", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    const email = `threeway-${RUN}@example.test`;
    const [a] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Three', 'Way', 'agent', 'active', 'en')`,
      [email],
    );
    agentId = a.insertId;
    token = await createSession("admin", agentId, email, "127.0.0.1", "vitest-3w");
    const [p] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, '3W line', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [`+1766${String(Date.now()).slice(-7)}`, agentId],
    );
    phoneId = p.insertId;
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await pool.query(`DELETE FROM voice_three_way_sessions WHERE id IN (?)`, [sessionIds]);
    }
    await pool.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneId]);
    await pool.query(`DELETE FROM admins WHERE id = ?`, [agentId]);
    await pool.end();
  });

  it("outbound calls still end exactly as before (empty response) when no third caller", async () => {
    const twiml = await request(app)
      .post("/api/voice/twiml")
      .type("form")
      .send({ To: "+19495550123", From: `client:admin_${agentId}` });
    expect(twiml.text).toContain("/api/voice/outbound-dial-end");
    const end = await request(app)
      .post("/api/voice/outbound-dial-end")
      .type("form")
      .send({ CallSid: `CAnone${RUN}`, DialCallStatus: "completed" });
    expect(end.text).toBe("<Response></Response>");
  });

  it("moves the other leg into the conference once 'Add caller' started", async () => {
    const [s] = await pool.query<ResultSetHeader>(
      `INSERT INTO voice_three_way_sessions
         (conference_name, direction, staff_call_sid, customer_call_sid, admin_id, from_e164,
          third_party_number, status)
       VALUES (?, 'outbound', ?, ?, ?, '+19495550000', '+18775550100', 'moving')`,
      [`ofg3w_CAcust${RUN}`, `CAstaff${RUN}`, `CAcust${RUN}`, agentId],
    );
    sessionIds.push(s.insertId);
    const end = await request(app)
      .post("/api/voice/outbound-dial-end")
      .type("form")
      .send({ CallSid: `CAstaff${RUN}`, DialCallStatus: "completed" });
    expect(end.text).toContain(`ofg3w_CAcust${RUN}`);

    // Inbound side: dial-status for the client's leg joins the same room.
    const dial = await request(app)
      .post("/api/voice/dial-status")
      .type("form")
      .send({ CallSid: `CAcust${RUN}`, DialCallStatus: "completed", To: "+19495550000", From: "+19495551111" });
    expect(dial.text).toContain(`ofg3w_CAcust${RUN}`);
  });

  it("validates Add caller input before touching Twilio", async () => {
    const bad = await request(app)
      .post("/api/voice/three-way/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ call_sid: "CAx", to: "+52 33 1111 2222" });
    expect(bad.status).toBe(400);
    const digits = await request(app)
      .post("/api/voice/three-way/digits")
      .set("Authorization", `Bearer ${token}`)
      .send({ session_id: 1, digits: "abc" });
    expect(digits.status).toBe(400);
    const presets = await request(app)
      .get("/api/voice/three-way/presets")
      .set("Authorization", `Bearer ${token}`);
    expect(presets.status).toBe(200);
    expect(Array.isArray(presets.body.presets)).toBe(true);
  });
});
