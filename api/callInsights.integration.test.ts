/**
 * Call insights cron edge cases — gate, reclaim, too_short, voicemail wait, Dial skip.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer } from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
  VITEST_CRON_SECRET,
} from "./testDbCleanup";

const RUN_ID = `call-ins-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let prevCron: string | undefined;
let prevEnabled: string | undefined;
let prevOpenAi: string | undefined;
let clientId = 0;
let conversationId = 0;
const messageIds: number[] = [];
const clientIds: number[] = [];

async function insertCallMessage(opts: {
  body: string;
  duration: number | null;
  status: string | null;
  error?: string | null;
  transcript?: string | null;
  metadata?: Record<string, unknown>;
  updatedAtSql?: string;
  createdAtSql?: string;
}): Promise<number> {
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversation_messages
       (conversation_id, direction, channel, body, provider_status,
        call_duration_sec, recording_url, metadata_json,
        call_insights_status, call_transcript, call_insights_error,
        call_insights_updated_at, created_at)
     VALUES (?, 'inbound', 'call', ?, 'completed', ?,
             'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE${RUN_ID}.mp3',
             ?, ?, ?, ?,
             ${opts.updatedAtSql || "NOW()"},
             ${opts.createdAtSql || "NOW()"})`,
    [
      conversationId,
      opts.body,
      opts.duration,
      JSON.stringify(opts.metadata || {}),
      opts.status,
      opts.transcript ?? null,
      opts.error ?? null,
    ],
  );
  const id = Number(ins.insertId);
  messageIds.push(id);
  return id;
}

async function runCron() {
  return request(app)
    .get("/api/cron/process-queue")
    .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
    .expect(200);
}

describe("call insights cron", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevCron = process.env.CRON_SECRET;
    prevEnabled = process.env.CALL_INSIGHTS_ENABLED;
    prevOpenAi = process.env.OPENAI_API_KEY;
    process.env.CRON_SECRET = VITEST_CRON_SECRET;
    process.env.CALL_INSIGHTS_ENABLED = "1";
    // Force Dial/voicemail STT branches that do not need Whisper.
    delete process.env.OPENAI_API_KEY;

    pool = createIntegrationTestPool();
    app = createServer();

    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('Call', ?, ?, 'active', 'new_client', 'en')`,
      [RUN_ID, `call-ins-${RUN_ID}@example.test`],
    );
    clientId = Number(cIns.insertId);
    clientIds.push(clientId);

    const [cvIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversations (client_id, channel, status, last_message_at)
       VALUES (?, 'call', 'open', NOW())`,
      [clientId],
    );
    conversationId = Number(cvIns.insertId);
  }, 60_000);

  afterAll(async () => {
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
    if (prevEnabled === undefined) delete process.env.CALL_INSIGHTS_ENABLED;
    else process.env.CALL_INSIGHTS_ENABLED = prevEnabled;
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;

    if (messageIds.length) {
      await pool
        .query(`DELETE FROM conversation_messages WHERE id IN (?)`, [
          messageIds,
        ])
        .catch(() => {});
    }
    if (conversationId) {
      await pool
        .query(`DELETE FROM conversations WHERE id = ?`, [conversationId])
        .catch(() => {});
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    await pool?.end();
  }, 60_000);

  it("returns call_insights stats shape; kill-switch CALL_INSIGHTS_ENABLED=0 skips", async () => {
    process.env.CALL_INSIGHTS_ENABLED = "0";
    const res = await runCron();
    expect(res.body.ok).toBe(true);
    expect(res.body.call_insights).toMatchObject({
      processed: 0,
      ready: 0,
      failed: 0,
      skipped: 0,
      reclaimed: 0,
    });
    process.env.CALL_INSIGHTS_ENABLED = "1";
  }, 45_000);

  it("skips too-short recordings and reclaims stuck processing", async () => {
    const shortId = await insertCallMessage({
      body: `too short ${RUN_ID}`,
      duration: 2,
      status: "pending",
    });
    const stuckId = await insertCallMessage({
      body: `stuck processing ${RUN_ID}`,
      duration: 40,
      status: "processing",
      error: "old-claim-tag",
      transcript: null,
      metadata: { is_voicemail: false },
      updatedAtSql: "NOW() - INTERVAL 20 MINUTE",
    });

    const res = await runCron();
    expect(res.body.ok).toBe(true);
    expect(Number(res.body.call_insights?.reclaimed || 0)).toBeGreaterThanOrEqual(
      1,
    );
    expect(Number(res.body.call_insights?.skipped || 0)).toBeGreaterThanOrEqual(
      1,
    );

    const [shortRow] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [shortId],
    );
    expect(shortRow[0]?.call_insights_status).toBe("skipped");
    expect(String(shortRow[0]?.call_insights_error || "")).toBe("too_short");

    const [stuckRow] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [stuckId],
    );
    // Reclaimed → pending → claimed → skipped (Dial, no OpenAI, no transcript).
    expect(["skipped", "pending", "failed"]).toContain(
      String(stuckRow[0]?.call_insights_status || ""),
    );
    expect(String(stuckRow[0]?.call_insights_error || "")).not.toBe(
      "old-claim-tag",
    );
  }, 60_000);

  it("awaits Twilio transcript for young voicemail without OpenAI", async () => {
    const vmId = await insertCallMessage({
      body: `voicemail wait ${RUN_ID}`,
      duration: 25,
      status: "pending",
      metadata: { is_voicemail: true },
      createdAtSql: "NOW() - INTERVAL 2 MINUTE",
    });

    const res = await runCron();
    expect(res.body.ok).toBe(true);

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [vmId],
    );
    expect(row[0]?.call_insights_status).toBe("pending");
    expect(String(row[0]?.call_insights_error || "")).toBe(
      "awaiting_twilio_transcript",
    );
  }, 60_000);

  it("skips Dial recording without OpenAI when no transcript", async () => {
    const dialId = await insertCallMessage({
      body: `dial missing openai ${RUN_ID}`,
      duration: 55,
      status: "pending",
      metadata: { is_voicemail: false },
    });

    await runCron();

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [dialId],
    );
    expect(row[0]?.call_insights_status).toBe("skipped");
    expect(String(row[0]?.call_insights_error || "")).toBe(
      "missing_openai_stt",
    );
  }, 60_000);

  it("marks transcript-ready without Claude when Anthropic unset", async () => {
    const prevAnth = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const readyId = await insertCallMessage({
        body: `transcript only ${RUN_ID}`,
        duration: 48,
        status: "pending",
        transcript: `Client asked about Round 2 status. Feeling hopeful. RUN ${RUN_ID}.`,
        metadata: { is_voicemail: false },
      });

      const res = await runCron();
      expect(res.body.ok).toBe(true);
      expect(Number(res.body.call_insights?.ready || 0)).toBeGreaterThanOrEqual(
        1,
      );

      const [row] = await pool.query<RowDataPacket[]>(
        `SELECT call_insights_status, call_transcript, call_insights_error,
                call_insights_json
         FROM conversation_messages WHERE id = ?`,
        [readyId],
      );
      expect(row[0]?.call_insights_status).toBe("ready");
      expect(String(row[0]?.call_transcript || "")).toContain(RUN_ID);
      expect(String(row[0]?.call_insights_error || "")).toBe(
        "claude_unavailable",
      );
      expect(row[0]?.call_insights_json == null).toBe(true);
    } finally {
      if (prevAnth === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnth;
    }
  }, 60_000);

  it("processes transcript rows via Claude path (ready with or without resume)", async () => {
    if (!String(process.env.ANTHROPIC_API_KEY || "").trim()) {
      // eslint-disable-next-line no-console
      console.warn("[skip] ANTHROPIC_API_KEY unset — Claude path not exercised");
      return;
    }
    const readyId = await insertCallMessage({
      body: `ready path ${RUN_ID}`,
      duration: 48,
      status: "pending",
      transcript: `Client asked about Round 2 status and FHA timeline. Feeling hopeful. Mentioned closing next month. RUN ${RUN_ID}.`,
      metadata: { is_voicemail: false },
    });

    const res = await runCron();
    expect(res.body.ok).toBe(true);
    const ci = res.body.call_insights || {};
    expect(Number(ci.ready || 0)).toBeGreaterThanOrEqual(1);

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_json, call_transcript,
              call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [readyId],
    );
    expect(String(row[0]?.call_insights_status || "")).toBe("ready");
    // Transcript is always persisted (transcript-first).
    expect(String(row[0]?.call_transcript || "")).toContain(RUN_ID);
    const raw = row[0]?.call_insights_json;
    if (raw) {
      const parsed =
        typeof raw === "string"
          ? JSON.parse(raw)
          : (raw as Record<string, unknown>);
      expect(Array.isArray(parsed?.summary_bullets)).toBe(true);
      expect((parsed.summary_bullets as unknown[]).length).toBeGreaterThan(0);
    } else {
      // Live key may be expired/restricted — still ready with transcript.
      expect(String(row[0]?.call_insights_error || "").length).toBeGreaterThan(
        0,
      );
    }
  }, 90_000);
});
