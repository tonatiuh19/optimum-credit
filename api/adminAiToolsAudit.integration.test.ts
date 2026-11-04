/**
 * Admin AI / MCP tool gaps found in the Oct 24 audit:
 *  - phones typed through Claude / MCP get the +1 storage format (args never pass the HTTP middleware);
 *  - list_round_schedule returns extended rounds 6–24 and the case max;
 *  - get_scorecard follows the page rules (own card; Cesar / Alex any + team);
 *  - list_reports_pending_approval lists reports held by the approval gate.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { executeAdminAiTool } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const LECCA = 150002;
const ANGEL = 120001;
const CESAR = 90001;
const ALEX = 30001;

let pool: Pool;
let clientId = 0;
let caseId = 0;

beforeAll(async () => {
  pool = createIntegrationTestPool();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Audit', 'Tools', ?, 'active', 'round_5')`,
    [`ai-tools-audit-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, max_rounds) VALUES (?, 'round_5', 'active', 8)`,
    [clientId],
  );
  caseId = k.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [caseId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.end();
});

describe("phones through Claude / MCP", () => {
  it("update_client dry-run stores a typed US number as +1", async () => {
    const r: any = await executeAdminAiTool("update_client", { client_id: clientId, phone: "(555) 999-8888" }, { adminId: CESAR });
    expect(r.ok).toBe(true);
    expect(r.data.preview.patch.phone).toBe("+15559998888");
  }, 60_000);
});

describe("list_round_schedule", () => {
  it("returns extended rounds 6+ and the case max rounds", async () => {
    await pool.query(
      `INSERT INTO case_round_schedules (case_id, round_1_date, round_2_date, round_3_date, round_4_date, round_5_date, extended_dates_json, calendar_uid_ns)
       VALUES (?, '2026-05-01', '2026-06-05', '2026-07-10', '2026-08-14', '2026-09-18', ?, ?)`,
      [caseId, JSON.stringify({ 6: "2026-10-23", 7: "2026-11-27" }), `audit-${Date.now()}`],
    );
    const r: any = await executeAdminAiTool("list_round_schedule", { case_id: caseId }, { adminId: CESAR });
    expect(r.ok).toBe(true);
    expect(r.data.max_rounds).toBe(8);
    expect(r.data.rounds.map((x: any) => x.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.data.rounds[5].date).toBe("2026-10-23");
  }, 60_000);
});

describe("get_scorecard", () => {
  it("own card; another person's card only for managers; team for managers", async () => {
    const own: any = await executeAdminAiTool("get_scorecard", {}, { adminId: LECCA });
    expect(own.ok).toBe(true);
    expect(own.data.profile).toBe("ops");
    expect(own.data.metrics.length).toBe(8);
    const peek: any = await executeAdminAiTool("get_scorecard", { admin_id: LECCA }, { adminId: ANGEL });
    expect(peek).toMatchObject({ ok: false, error: "forbidden" });
    const teamDenied: any = await executeAdminAiTool("get_scorecard", { team: true }, { adminId: ANGEL });
    expect(teamDenied).toMatchObject({ ok: false, error: "forbidden" });
    const team: any = await executeAdminAiTool("get_scorecard", { team: true }, { adminId: CESAR });
    expect(team.data.members.map((m: any) => m.admin_id).sort()).toEqual([ANGEL, LECCA]);
    const other: any = await executeAdminAiTool("get_scorecard", { admin_id: ANGEL }, { adminId: CESAR });
    expect(other.data.profile).toBe("sales");
    const notScored: any = await executeAdminAiTool("get_scorecard", {}, { adminId: ALEX });
    expect(notScored).toMatchObject({ ok: false, error: "not_found" });
  }, 180_000);
});

describe("list_reports_pending_approval", () => {
  it("lists reports held by the approval gate with their failed checks", async () => {
    await pool.query(
      `INSERT INTO client_round_reports (client_id, case_id, round_number, score_before, score_after, items_removed, report_locale, delivery_status, self_check_json)
       VALUES (?, ?, 6, 600, 610, 0, 'en', 'needs_review', ?)`,
      [clientId, caseId, JSON.stringify([{ key: "account_totals", pass: false, detail: "Before TU: 11 accounts read, summary 32" }])],
    );
    const r: any = await executeAdminAiTool("list_reports_pending_approval", { client_id: clientId }, { adminId: CESAR });
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(1);
    // The capped list still reports how many are really waiting.
    const capped: any = await executeAdminAiTool("list_reports_pending_approval", { limit: 1 }, { adminId: CESAR });
    expect(capped.data.reports).toHaveLength(1);
    expect(capped.data.total).toBeGreaterThanOrEqual(1);
    const mine = r.data.reports.find((x: any) => x.client_id === clientId);
    expect(mine).toMatchObject({ round: 6, approval: { status: "needs_review", client_visible: false } });
    expect(mine.approval.failed_checks).toEqual([{ key: "account_totals", detail: "Before TU: 11 accounts read, summary 32" }]);
    expect(r.data.guidance).toMatch(/NOT with the client/);
  }, 60_000);
});
