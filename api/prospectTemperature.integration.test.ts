/**
 * Prospect traffic light (semáforo) — engine against the real DB.
 * Alerts go only to fixture admins under Vitest; we assert DB state.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, recomputeProspectTemperatures } from "./index";
import { createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const RUN = `semaforo-${Date.now()}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let clientId = 0;
let conversationId = 0;

async function light(): Promise<RowDataPacket> {
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT lead_temperature, lead_temperature_reasons, lead_hot_stale_alerted_at,
            lead_convert_suggested_at FROM clients WHERE id = ?`,
    [clientId],
  );
  return r[0];
}

describe("prospect traffic light engine", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status='active' AND role IN ('super_admin','admin') ORDER BY id LIMIT 1`,
    );
    token = await createSession("admin", Number(admins[0].id), String(admins[0].email), "127.0.0.1", "vitest-semaforo");
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('Sema', 'Foro', ?, ?, 'prospect', 'prospect', 'es')`,
      [`${RUN}@example.test`, uniqueTestE164(RUN)],
    );
    clientId = c.insertId;
    const [cv] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversations (client_id, channel) VALUES (?, 'sms')`,
      [clientId],
    );
    conversationId = cv.insertId;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await pool.end();
  });

  it("first color is a silent baseline (cold, no backlog alerts)", async () => {
    await recomputeProspectTemperatures(clientId);
    const r = await light();
    expect(r.lead_temperature).toBe("cold");
    expect(r.lead_hot_stale_alerted_at).not.toBeNull();
  });

  it("recent reply → Tibio", async () => {
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, direction, channel, body) VALUES (?, 'inbound', 'sms', 'hola')`,
      [conversationId],
    );
    await recomputeProspectTemperatures(clientId);
    expect((await light()).lead_temperature).toBe("warm");
  });

  it("'Analysis reviewed' button → Caliente immediately", async () => {
    const res = await request(app)
      .post(`/api/admin/clients/${clientId}/lead-signals`)
      .set("Authorization", `Bearer ${token}`)
      .send({ analysis_reviewed: true });
    expect(res.status).toBe(200);
    expect(res.body.lead_temperature).toBe("hot");
    expect(res.body.lead_temperature_reasons).toContain("analysis_reviewed");
  });

  it("Hot with no movement for 3+ days alerts Cesar once", async () => {
    await pool.query(
      `UPDATE conversation_messages SET created_at = NOW() - INTERVAL 5 DAY WHERE conversation_id = ?`,
      [conversationId],
    );
    await pool.query(
      `UPDATE clients SET analysis_reviewed_at = NOW() - INTERVAL 5 DAY,
              lead_temperature_at = NOW() - INTERVAL 5 DAY,
              lead_hot_stale_alerted_at = NOW() - INTERVAL 6 DAY WHERE id = ?`,
      [clientId],
    );
    await recomputeProspectTemperatures(clientId);
    const first = await light();
    expect(new Date(first.lead_hot_stale_alerted_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    await recomputeProspectTemperatures(clientId);
    const second = await light();
    expect(String(second.lead_hot_stale_alerted_at)).toBe(String(first.lead_hot_stale_alerted_at));
  });

  it("a successful payment suggests conversion (once)", async () => {
    await pool.query(
      `INSERT INTO payments (client_id, amount_cents, status, provider, provider_transaction_id)
       VALUES (?, 100, 'succeeded', 'manual', ?)`,
      [clientId, `semaforo-${RUN}`],
    );
    await recomputeProspectTemperatures(clientId);
    expect((await light()).lead_convert_suggested_at).not.toBeNull();
  });

  it("filters the pipeline prospect column by color", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ lead_temperature: "hot", search: "Sema Foro" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = (res.body.prospects || []).map((p: { id: number }) => p.id);
    expect(ids).toContain(clientId);
    const cold = await request(app)
      .get("/api/admin/pipeline")
      .query({ lead_temperature: "cold", search: "Sema Foro" })
      .set("Authorization", `Bearer ${token}`);
    expect((cold.body.prospects || []).map((p: { id: number }) => p.id)).not.toContain(clientId);
  });

  it("Claude/ATLAS can list prospects by color (Hot first)", async () => {
    const res = await request(app)
      .post("/api/admin/ai/tools/list_prospects_by_temperature")
      .set("Authorization", `Bearer ${token}`)
      .send({ color: "hot", language: "es", limit: 50 });
    expect(res.status).toBe(200);
    const row = (res.body.data?.prospects || res.body.result?.data?.prospects || []).find(
      (p: { client_id: number }) => p.client_id === clientId,
    );
    expect(row).toBeTruthy();
    expect(row.color).toBe("hot");
    expect(row.reasons).toContain("analysis_reviewed");
  });

  const tool = (name: string, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/ai/tools/${name}`).set("Authorization", `Bearer ${token}`).send(body);
  const dataOf = (res: request.Response) => res.body.data ?? res.body.result?.data;

  it("Claude: update_lead_signals previews, then records a scheduled call on confirm", async () => {
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const dry = await tool("update_lead_signals", { client_id: clientId, call_scheduled_at: when });
    expect(dataOf(dry).dry_run).toBe(true);
    const [before] = await pool.query<RowDataPacket[]>(`SELECT call_scheduled_at FROM clients WHERE id = ?`, [clientId]);
    expect(before[0].call_scheduled_at).toBeNull();
    const done = await tool("update_lead_signals", {
      client_id: clientId, call_scheduled_at: when, confirm: true, confirm_phrase: "CONFIRM",
    });
    expect(dataOf(done).updated).toBe(true);
    expect(dataOf(done).lead_temperature_reasons).toContain("call_scheduled");
  });

  it("Claude: get_client shows the traffic light and the NEWEST notes", async () => {
    const old = "OLD-NOTE ".repeat(120);
    await pool.query(`UPDATE clients SET admin_notes = ? WHERE id = ?`, [`${old}\nLATEST: paused for payment`, clientId]);
    const res = await tool("get_client", { client_id: clientId });
    const d = dataOf(res);
    const client = d.client ?? d;
    expect(client.lead_temperature).toBe("hot");
    expect(String(client.notes_excerpt)).toContain("LATEST: paused for payment");
  });

  it("Claude: pipeline_summary has traffic-light counts; enhanced status reads", async () => {
    const sum = dataOf(await tool("pipeline_summary", { search: "Sema Foro" }));
    expect(sum.prospect_traffic_light.hot).toBeGreaterThanOrEqual(1);
    const enh = dataOf(await tool("get_enhanced_report_status", { client_id: clientId }));
    expect(Array.isArray(enh.reads)).toBe(true);
  });

  it("clears the light once the client is no longer a prospect", async () => {
    await pool.query(`UPDATE clients SET status = 'cancelled' WHERE id = ?`, [clientId]);
    await recomputeProspectTemperatures(clientId);
    expect((await light()).lead_temperature).toBeNull();
  });
});
