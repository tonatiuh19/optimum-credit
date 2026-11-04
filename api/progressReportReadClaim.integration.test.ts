/**
 * Engine Spec v1 PR-P0-1: concurrent polls / previews never queue the same
 * account-level read twice (atomic claim, 5-minute window). Real DB.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { claimProgressReadQueue } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

let pool: Pool;
let clientId = 0;
let caseId = 0;
let sessionId = 0;

describe("claimProgressReadQueue", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    const [[admin]] = await pool.query<RowDataPacket[]>(`SELECT id FROM admins WHERE status = 'active' ORDER BY id LIMIT 1`);
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Claim', 'Test', ?, 'active', 'round_1')`,
      [`claim-${Date.now()}@example.test`],
    );
    clientId = c.insertId;
    const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_1', 'active')`, [clientId]);
    caseId = k.insertId;
    const [s] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, created_by_admin_id) VALUES (?, ?, 1, 'review', '{}', ?)`,
      [caseId, clientId, admin.id],
    );
    sessionId = s.insertId;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM report_wizard_sessions WHERE id = ?`, [sessionId]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await pool.end();
  });

  it("first caller wins; parallel callers lose; purposes are independent", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => claimProgressReadQueue(sessionId, "progress_before")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimProgressReadQueue(sessionId, "progress_before")).toBe(false);
    expect(await claimProgressReadQueue(sessionId, "progress_after")).toBe(true);
  });

  it("re-claimable after 5 minutes (e.g. retry after a failed read)", async () => {
    await pool.query(
      `UPDATE report_wizard_sessions SET extraction_meta = JSON_SET(extraction_meta, '$.reads_queued_at.progress_before', UNIX_TIMESTAMP() - 301) WHERE id = ?`,
      [sessionId],
    );
    expect(await claimProgressReadQueue(sessionId, "progress_before")).toBe(true);
  });

  it("keeps other extraction_meta keys", async () => {
    await pool.query(`UPDATE report_wizard_sessions SET extraction_meta = JSON_OBJECT('confidence', 0.7) WHERE id = ?`, [sessionId]);
    expect(await claimProgressReadQueue(sessionId, "progress_after")).toBe(true);
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT extraction_meta FROM report_wizard_sessions WHERE id = ?`, [sessionId]);
    const meta = typeof row.extraction_meta === "string" ? JSON.parse(row.extraction_meta) : row.extraction_meta;
    expect(meta.confidence).toBe(0.7);
    expect(typeof meta.reads_queued_at.progress_after).toBe("number");
  });
});
