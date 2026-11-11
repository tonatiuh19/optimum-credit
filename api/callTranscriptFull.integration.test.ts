/**
 * get_call_insights returns COMPLETE transcripts (Nov 10, 2026 — Cesar: a 35-min
 * call was cut in half). One call → whole transcript (parts past 120k chars);
 * several calls → each shortened but flagged, with how to get the rest.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { executeAdminAiTool } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const CESAR = 90001;
const RUN = `ctf${Date.now()}`;
let pool: Pool;
let clientId = 0;
let conversationId = 0;

/** Distinct text so slices can be checked exactly. */
const transcriptOf = (chars: number, tag: string) => {
  let s = "";
  let i = 0;
  while (s.length < chars) s += `[${tag} line ${i++}] Agent: thanks for calling. Client: I have a question about my report. `;
  return s.slice(0, chars - 4) + "END.";
};

async function addCall(transcript: string, minutes: number) {
  const [m] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversation_messages (conversation_id, direction, channel, body, call_duration_sec, recording_url, call_insights_status, call_transcript)
     VALUES (?, 'inbound', 'call', ?, ?, 'vitest://recording.mp3', 'ready', ?)`,
    [conversationId, `Call ${RUN}`, minutes * 60, transcript],
  );
  return m.insertId;
}
const call = (args: Record<string, unknown>) => executeAdminAiTool("get_call_insights", args, { adminId: CESAR }) as Promise<any>;

beforeAll(async () => {
  pool = createIntegrationTestPool();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Call', ?, ?, 'active', 'round_1')`,
    [RUN, `${RUN}@example.test`],
  );
  clientId = c.insertId;
  const [cv] = await pool.query<ResultSetHeader>(`INSERT INTO conversations (client_id, channel, status) VALUES (?, 'call', 'open')`, [clientId]);
  conversationId = cv.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM conversation_messages WHERE conversation_id = ?`, [conversationId]);
  await pool.query(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
  await cleanupIntegrationTestClients(pool, { runId: RUN, clientIds: [clientId] });
  await pool.end();
}, 60_000);

describe("get_call_insights full transcripts", () => {
  it("a 35-minute call (39k chars) comes back complete when asked for by message_id", async () => {
    const t = transcriptOf(39_086, "long");
    const id = await addCall(t, 35);
    const r = await call({ client_id: clientId, message_id: id });
    expect(r.ok).toBe(true);
    const c = r.data.calls[0];
    expect(c.transcript_full).toBe(t);
    expect(c).toMatchObject({ transcript_total_chars: 39_086, transcript_complete: true, transcript_truncated: false, transcript_next_offset: null });
    expect(c.transcript_note).toBeUndefined();
    expect(c.transcript_full.endsWith("END.")).toBe(true);
  });

  it("listing several calls shortens each one but says so and how to get the rest", async () => {
    await addCall(transcriptOf(500, "short"), 1);
    const r = await call({ client_id: clientId, limit: 3 });
    expect(r.data.calls.length).toBe(2);
    const long = r.data.calls.find((c: any) => c.transcript_total_chars === 39_086);
    expect(long).toMatchObject({ transcript_complete: false, transcript_truncated: true, transcript_range: { start: 0, end: 12_000 } });
    expect(long.transcript_full).toHaveLength(12_000);
    expect(long.transcript_note).toMatch(new RegExp(`message_id=${long.message_id}`));
    const short = r.data.calls.find((c: any) => c.transcript_total_chars === 500);
    expect(short).toMatchObject({ transcript_complete: true, transcript_truncated: false });
  });

  it("a very long call (250k chars) is read in parts with transcript_offset and nothing is lost", async () => {
    const t = transcriptOf(250_000, "huge");
    const id = await addCall(t, 240);
    let offset = 0;
    let rebuilt = "";
    let parts = 0;
    for (;;) {
      const r = await call({ message_id: id, transcript_offset: offset });
      const c = r.data.calls[0];
      rebuilt += c.transcript_full;
      parts++;
      if (c.transcript_next_offset == null) {
        expect(c.transcript_note).toBeUndefined();
        break;
      }
      expect(c.transcript_note).toMatch(/transcript_offset=/);
      offset = c.transcript_next_offset;
      if (parts > 5) throw new Error("did not finish");
    }
    expect(parts).toBe(3);
    expect(rebuilt).toBe(t);
    const past = await call({ message_id: id, transcript_offset: 999_999 });
    expect(past.data.calls[0]).toMatchObject({ transcript_full: "", transcript_next_offset: null });
  });

  it("limit=1 also returns the whole transcript", async () => {
    const r = await call({ client_id: clientId, limit: 1 });
    const c = r.data.calls[0];
    expect(c.transcript_total_chars).toBe(250_000);
    expect(c.transcript_full).toHaveLength(120_000);
    expect(c.transcript_next_offset).toBe(120_000);
  });
});
