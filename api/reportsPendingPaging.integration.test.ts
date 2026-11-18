/**
 * Nov 17, 2026 (Cesar): list_reports_pending_approval returned only the oldest 50 of 511 — paging with
 * offset / next_offset, plus status and latest_round_only filters. Test client only.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { executeAdminAiTool } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const CESAR = 90001;
let pool: Pool;
let clientId = 0;
const ids: number[] = [];

beforeAll(async () => {
  pool = createIntegrationTestPool();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Paging', 'Pending', ?, 'active', 'round_3')`,
    [`paging-pending-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  for (const [round, status] of [[1, "pending_approval"], [2, "needs_review"], [3, "pending_approval"]] as const) {
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports (client_id, round_number, score_before, score_after, items_removed, report_locale, delivery_status, self_check_json, created_at)
       VALUES (?, ?, 600, 610, 0, 'en', ?, '[]', DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      [clientId, round, status, 10 - round],
    );
    ids.push(r.insertId);
  }
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.end();
}, 60_000);

const list = async (args: Record<string, unknown>) =>
  ((await executeAdminAiTool("list_reports_pending_approval", { client_id: clientId, ...args }, { adminId: CESAR })) as any).data;

describe("list_reports_pending_approval paging", () => {
  it("pages through every report with offset / next_offset, oldest first, no repeats", async () => {
    const seen: number[] = [];
    let page = await list({ limit: 1 });
    expect(page).toMatchObject({ total: 3, offset: 0, returned: 1, has_more: true, next_offset: 1 });
    seen.push(page.reports[0].round_report_id);
    while (page.has_more) {
      page = await list({ limit: 1, offset: page.next_offset });
      seen.push(...page.reports.map((r: { round_report_id: number }) => r.round_report_id));
    }
    expect(seen).toEqual(ids);
    expect(page).toMatchObject({ has_more: false, next_offset: null });
    expect((await list({ offset: 99 })).reports).toEqual([]);
  });

  it("filters: status and latest round only", async () => {
    expect((await list({ status: "needs_review" })).reports.map((r: { round: number }) => r.round)).toEqual([2]);
    expect((await list({ status: "pending_approval" })).total).toBe(2);
    const latest = await list({ latest_round_only: true });
    expect(latest.total).toBe(1);
    expect(latest.reports[0]).toMatchObject({ round: 3, is_latest_round: true });
    expect((await list({})).reports.find((r: { round: number }) => r.round === 1).is_latest_round).toBe(false);
  });
});
