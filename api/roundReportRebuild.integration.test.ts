/**
 * Rebuild a held report (Nov 6, 2026): a never-sent report on the client's latest round goes back to
 * its wizard session's Review step (same reads, no re-upload) so publishing again re-runs the current
 * reader and self-check. Test client / sessions only (example.test).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const LECCA = 150002; // EN language owner
const ANGEL = 120001; // ES owner (not an approver for EN reports)

let pool: Pool;
let app: ReturnType<typeof createServer>;
let clientId = 0;
let caseId = 0;
const tokens: Record<number, string> = {};

async function publishedRound(round: number, status: string) {
  const [s] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, created_by_admin_id, status) VALUES (?, ?, ?, ?, 'published')`,
    [caseId, clientId, round, LECCA],
  );
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO client_round_reports (client_id, case_id, round_number, score_before, score_after, items_removed, report_locale,
       delivery_status, self_check_json, delivery_options_json, wizard_session_id, pdf_storage_key, pdf_file_name)
     VALUES (?, ?, ?, 600, 620, 1, 'en', ?, '[]', '{}', ?, 'vitest://rebuild.pdf', 'rebuild.pdf')`,
    [clientId, caseId, round, status, s.insertId],
  );
  await pool.query(
    `INSERT INTO round_report_pdfs (client_id, round_number, round_report_id, file_name, storage_key, storage_provider, encrypted)
     VALUES (?, ?, ?, 'rebuild.pdf', 'vitest://rebuild.pdf', 'local', 0)`,
    [clientId, round, r.insertId],
  );
  await pool.query(`UPDATE report_wizard_sessions SET round_report_id = ? WHERE id = ?`, [r.insertId, s.insertId]);
  return { reportId: r.insertId, sessionId: s.insertId };
}

const rebuild = (id: number, admin: number) =>
  request(app).post(`/api/admin/round-reports/${id}/rebuild`).set("Authorization", `Bearer ${tokens[admin]}`).send({});

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Rebuild', 'Held', ?, 'active', 'round_3')`,
    [`rebuild-held-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases (case_number, client_id, pipeline_stage, status) VALUES (?, ?, 'round_3', 'active')`,
    [`CR-RB${Date.now()}`.slice(0, 20), clientId],
  );
  caseId = k.insertId;
  for (const id of [LECCA, ANGEL]) tokens[id] = await createSession("admin", id, `rebuild-${id}@example.test`, "127.0.0.1", "vitest-rebuild-held");
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'client' AND entity_id = ?`, [clientId]);
  await pool.query(`DELETE FROM round_report_pdfs WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-rebuild-held'`).catch(() => null);
  await pool.end();
});

describe("rebuild a held report", () => {
  it("guards: not the approver → 403; an earlier round → 409 not_latest_round", async () => {
    const r1 = await publishedRound(1, "silent");
    const r2 = await publishedRound(2, "needs_review");
    expect((await rebuild(r2.reportId, ANGEL)).status).toBe(403);
    const early = await publishedRound(3, "needs_review");
    const res = await rebuild(r2.reportId, LECCA);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("not_latest_round");
    // A report already released is never rebuilt.
    await pool.query(`DELETE FROM round_report_pdfs WHERE round_report_id = ?`, [early.reportId]);
    await pool.query(`DELETE FROM client_round_reports WHERE id = ?`, [early.reportId]);
    await pool.query(`UPDATE client_round_reports SET delivery_status = 'silent' WHERE id = ?`, [r2.reportId]);
    const sent = await rebuild(r2.reportId, LECCA);
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe("not_rebuildable");
    expect(r1.reportId).toBeGreaterThan(0);
  }, 60_000);

  it("the held latest round goes back to Review with its session; the report and PDF are gone; audited; second click 404", async () => {
    const held = await publishedRound(4, "needs_review");
    const ok = await rebuild(held.reportId, LECCA);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, client_id: clientId, round_number: 4, session_id: held.sessionId });
    const [[s]] = await pool.query<RowDataPacket[]>(`SELECT status, round_report_id, output_pdf_id FROM report_wizard_sessions WHERE id = ?`, [held.sessionId]);
    expect(s).toMatchObject({ status: "review", round_report_id: null, output_pdf_id: null });
    const [gone] = await pool.query<RowDataPacket[]>(`SELECT id FROM client_round_reports WHERE id = ?`, [held.reportId]);
    expect(gone).toHaveLength(0);
    const [pdfs] = await pool.query<RowDataPacket[]>(`SELECT id FROM round_report_pdfs WHERE round_report_id = ?`, [held.reportId]);
    expect(pdfs).toHaveLength(0);
    const [[a]] = await pool.query<RowDataPacket[]>(
      `SELECT action FROM audit_logs WHERE entity_type = 'client' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      [clientId],
    );
    expect(a.action).toBe("report_wizard.rebuild_held_report");
    expect((await rebuild(held.reportId, LECCA)).status).toBe(404);
  }, 60_000);
});
