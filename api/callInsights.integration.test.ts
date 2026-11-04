/**
 * Call transcript cron edge cases — gate, reclaim, too_short, voicemail wait, Dial SID.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  createServer,
} from "./index";
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
    process.env.CRON_SECRET = VITEST_CRON_SECRET;
    process.env.CALL_INSIGHTS_ENABLED = "1";

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

  /**
   * Run the cron until every row reaches the wanted state (a parallel test
   * file's cron run may have processed — or still be processing — them).
   */
  async function runCronUntil(
    ids: number[],
    done: (row: { id: number; status: string; error: string }) => boolean,
    tries = 4,
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      const res = await runCron();
      expect(res.body.ok).toBe(true);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, call_insights_status, call_insights_error FROM conversation_messages WHERE id IN (?)`,
        [ids],
      );
      const mapped = rows.map((r) => ({ id: Number(r.id), status: String(r.call_insights_status || ""), error: String(r.call_insights_error || "") }));
      if (mapped.length === ids.length && mapped.every(done)) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

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

    // Other test files run the same cron in parallel and may claim these
    // rows first — assert on OUR rows' final state, not one run's counters.
    await runCronUntil([shortId, stuckId], (r) =>
      r.id === shortId ? r.status === "skipped" : r.status !== "processing" && r.error !== "old-claim-tag",
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
    // Reclaimed → pending → claimed → failed (placeholder recording URL).
    expect(["skipped", "pending", "failed"]).toContain(
      String(stuckRow[0]?.call_insights_status || ""),
    );
    expect(String(stuckRow[0]?.call_insights_error || "")).not.toBe(
      "old-claim-tag",
    );
  }, 60_000);

  it("awaits Twilio transcript for a young voicemail with no recording SID", async () => {
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

  it("fails a Dial recording that is not a Twilio recording SID", async () => {
    const dialId = await insertCallMessage({
      body: `dial invalid recording ${RUN_ID}`,
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
    expect(row[0]?.call_insights_status).toBe("failed");
    expect(String(row[0]?.call_insights_error || "")).toBe("invalid_recording");
  }, 60_000);

  it("stores a Twilio batch transcript from the status webhook", async () => {
    const recordingSid = "RE00000000000000000000000000000001";
    const hookId = await insertCallMessage({
      body: `twilio hook ${RUN_ID}`,
      duration: 40,
      status: "skipped",
      error: "missing_openai_stt",
      metadata: { is_voicemail: false },
    });
    await pool.query(
      `UPDATE conversation_messages
       SET recording_url = ?
       WHERE id = ?`,
      [
        `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/${recordingSid}.mp3`,
        hookId,
      ],
    );

    const res = await request(app)
      .post("/api/webhooks/twilio/call-transcript")
      .send({
        id: "voice_transcription_testhook01",
        accountId: process.env.TWILIO_ACCOUNT_SID || "",
        status: "completed",
        sourceId: recordingSid,
        sentences: [
          {
            audioChannelIndex: 1,
            sentenceIndex: 1,
            startTimeSeconds: 0.2,
            text: `Caller line ${RUN_ID}`,
          },
          {
            audioChannelIndex: 2,
            sentenceIndex: 2,
            startTimeSeconds: 1.1,
            text: "Agent line",
          },
        ],
      });
    expect(res.status).toBe(200);

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_transcript, call_insights_json, call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [hookId],
    );
    expect(String(row[0]?.call_insights_status || "")).toBe("ready");
    expect(String(row[0]?.call_transcript || "")).toContain(`Caller: Caller line ${RUN_ID}`);
    expect(String(row[0]?.call_transcript || "")).toContain("Agent: Agent line");
    expect(row[0]?.call_insights_json == null).toBe(true);
    expect(
      row[0]?.call_insights_error == null || row[0]?.call_insights_error === "",
    ).toBe(true);
  }, 60_000);

  it("accepts a large (long-call) transcript callback instead of 413", async () => {
    // 15-min calls with word-level detail exceed express' 100 KB default; the
    // 413 made Twilio log 17580 and drop the transcript (Joselton, Oct 16).
    const recordingSid = "RE00000000000000000000000000000002";
    const bigId = await insertCallMessage({
      body: `big hook ${RUN_ID}`,
      duration: 887,
      status: "pending",
      error: "awaiting_twilio_transcript",
      metadata: { is_voicemail: false },
    });
    await pool.query(`UPDATE conversation_messages SET recording_url = ? WHERE id = ?`, [
      `https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/${recordingSid}.mp3`,
      bigId,
    ]);
    const words = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, startTime: i, endTime: i + 0.5, confidence: 0.98 }));
    const sentences = Array.from({ length: 600 }, (_, i) => ({
      audioChannelIndex: (i % 2) + 1,
      sentenceIndex: i + 1,
      startTimeSeconds: i * 1.4,
      text: i === 0 ? `Long call start ${RUN_ID}` : `Sentence number ${i} of a long call about the credit report`,
      words,
    }));
    const payload = { id: "voice_transcription_testbig01", accountId: process.env.TWILIO_ACCOUNT_SID || "", status: "completed", sourceId: recordingSid, sentences };
    expect(JSON.stringify(payload).length).toBeGreaterThan(1_000_000);
    const res = await request(app).post("/api/webhooks/twilio/call-transcript").send(payload);
    expect(res.status).toBe(200);
    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_transcript FROM conversation_messages WHERE id = ?`,
      [bigId],
    );
    expect(String(row[0]?.call_insights_status)).toBe("ready");
    expect(String(row[0]?.call_transcript || "")).toContain(`Long call start ${RUN_ID}`);
  }, 60_000);

  it("marks transcript-ready without writing call insights", async () => {
    const readyId = await insertCallMessage({
      body: `transcript only ${RUN_ID}`,
      duration: 48,
      status: "pending",
      transcript: `Client asked about Round 2 status. Feeling hopeful. RUN ${RUN_ID}.`,
      metadata: { is_voicemail: false },
    });

    const res = await runCron();
    expect(res.body.ok).toBe(true);
    expect(Number(res.body.call_insights?.ready || 0)).toBeGreaterThanOrEqual(1);

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_transcript, call_insights_error,
              call_insights_json
       FROM conversation_messages WHERE id = ?`,
      [readyId],
    );
    expect(row[0]?.call_insights_status).toBe("ready");
    expect(String(row[0]?.call_transcript || "")).toContain(RUN_ID);
    expect(
      row[0]?.call_insights_error == null || row[0]?.call_insights_error === "",
    ).toBe(true);
    expect(row[0]?.call_insights_json == null).toBe(true);
  }, 60_000);

  it("stores the transcript and does not write call insights", async () => {
    const readyId = await insertCallMessage({
      body: `ready path ${RUN_ID}`,
      duration: 48,
      status: "pending",
      transcript: `Client asked about Round 2 status and FHA timeline. Feeling hopeful. Mentioned closing next month. RUN ${RUN_ID}.`,
      metadata: { is_voicemail: false },
    });

    await runCronUntil([readyId], (r) => r.status === "ready");

    const [row] = await pool.query<RowDataPacket[]>(
      `SELECT call_insights_status, call_insights_json, call_transcript,
              call_insights_error
       FROM conversation_messages WHERE id = ?`,
      [readyId],
    );
    expect(String(row[0]?.call_insights_status || "")).toBe("ready");
    expect(String(row[0]?.call_transcript || "")).toContain(RUN_ID);
    expect(row[0]?.call_insights_json == null).toBe(true);
    expect(
      row[0]?.call_insights_error == null || row[0]?.call_insights_error === "",
    ).toBe(true);
  }, 90_000);

  it("emails and bells the line owner once, and skips the backlog flag", async () => {
    const adminEmail = `call-tx-${RUN_ID}@example.test`;
    const [adminIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language, phone)
       VALUES (?, 'Transcript', 'Owner', 'agent', 'active', 'en', '+15555550123')`,
      [adminEmail],
    );
    const adminId = Number(adminIns.insertId);
    const [convIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversations
         (client_id, channel, status, assigned_admin_id, last_message_at)
       VALUES (?, 'call', 'open', ?, NOW())`,
      [clientId, adminId],
    );
    const ownedConversationId = Number(convIns.insertId);
    try {
      const [readyIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO conversation_messages
           (conversation_id, direction, channel, body, provider_status,
            call_duration_sec, recording_url, metadata_json,
            call_insights_status, call_transcript, call_insights_updated_at, created_at)
         VALUES (?, 'inbound', 'call', ?, 'completed', 40,
             'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/REcall-ins-notify.mp3',
             '{}', 'pending', ?, NOW(), NOW())`,
        [
          ownedConversationId,
          `notify ready ${RUN_ID}`,
          `Full transcript body ${RUN_ID}`,
        ],
      );
      const readyId = Number(readyIns.insertId);
      messageIds.push(readyId);

      __testClearEmailDryRuns();
      // A parallel test file's cron may process this row (its email then
      // lands in THAT worker's dry-run log) — the bell row is shared (DB).
      await runCronUntil([readyId], (r) => r.status === "ready");

      const [notes] = await pool.query<RowDataPacket[]>(
        `SELECT id, title, body, link_url
         FROM admin_notifications
         WHERE admin_id = ? AND event_key = 'call_transcript'`,
        [adminId],
      );
      expect(notes).toHaveLength(1);
      expect(String(notes[0]?.body || "")).toContain(RUN_ID);
      expect(String(notes[0]?.link_url || "")).toContain(
        `/admin/conversations?client=${clientId}`,
      );
      const emails = __testGetEmailDryRuns().filter((e) =>
        e.subject.includes(RUN_ID),
      );
      // Never more than one email; when this worker processed it, to the owner.
      expect(emails.length).toBeLessThanOrEqual(1);
      if (emails.length) expect(emails[0]?.to).toBe(adminEmail);

      await runCron();
      const [notesAgain] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM admin_notifications
         WHERE admin_id = ? AND event_key = 'call_transcript'`,
        [adminId],
      );
      expect(notesAgain).toHaveLength(1);

      const [skipIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO conversation_messages
           (conversation_id, direction, channel, body, provider_status,
            call_duration_sec, recording_url, metadata_json,
            call_insights_status, call_transcript, call_insights_updated_at, created_at)
         VALUES (?, 'inbound', 'call', ?, 'completed', 40,
             'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/REcall-ins-skip.mp3',
             JSON_OBJECT('skip_transcript_notify', CAST('true' AS JSON)),
             'pending', ?, NOW(), NOW())`,
        [
          ownedConversationId,
          `notify skip ${RUN_ID}`,
          `Backlog transcript ${RUN_ID}`,
        ],
      );
      messageIds.push(Number(skipIns.insertId));
      await runCron();
      const [notesAfterSkip] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM admin_notifications
         WHERE admin_id = ? AND event_key = 'call_transcript'`,
        [adminId],
      );
      expect(notesAfterSkip).toHaveLength(1);
    } finally {
      await pool.query(`DELETE FROM admins WHERE id = ?`, [adminId]);
    }
  }, 60_000);
});
