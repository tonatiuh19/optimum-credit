/**
 * Extended OFG rounds — PATCH /admin/cases/:id/extended-rounds + calendar/dashboard.
 * Requires DB_HOST + JWT_SECRET.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
  uniqueTestE164,
} from "./testDbCleanup";

const RUN_ID = `ext-rnd-${Date.now()}`;
const clientIds: number[] = [];

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";

function ymdOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function seedCompletedCase(opts?: {
  publishedRounds?: number;
  maxRounds?: number;
}): Promise<{ clientId: number; caseId: number }> {
  const published = opts?.publishedRounds ?? 5;
  const maxRounds = opts?.maxRounds ?? 5;
  const email = `ext-${RUN_ID}-${clientIds.length}@example.test`;
  const phone = uniqueTestE164(`ext-${RUN_ID}-${clientIds.length}`);

  const [cliIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients
       (email, phone, first_name, last_name, preferred_language, status, pipeline_stage,
        assigned_admin_id)
     VALUES (?, ?, 'Ext', ?, 'en', 'active', 'completed', ?)`,
    [email, phone, RUN_ID, adminId],
  );
  const clientId = cliIns.insertId;
  clientIds.push(clientId);

  const [caseIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases
       (client_id, case_number, pipeline_stage, status, max_rounds)
     VALUES (?, ?, 'completed', 'active', ?)`,
    [clientId, `CR-EX${String(clientId).slice(-4)}`, maxRounds],
  );
  const caseId = caseIns.insertId;

  for (let rn = 1; rn <= published; rn++) {
    await pool.query(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after, items_removed,
          items_disputed, summary_md)
       VALUES (?, ?, ?, 500, 520, 0, 0, ?)`,
      [clientId, caseId, rn, `R${rn} fixture ${RUN_ID}`],
    );
  }

  return { clientId, caseId };
}

describe("extended rounds — HTTP integration", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-extended-rounds",
    );
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of clientIds) {
        await pool.query(
          `DELETE FROM client_round_reports WHERE client_id = ?`,
          [id],
        );
        await pool.query(
          `DELETE FROM client_pipeline_history WHERE client_id = ?`,
          [id],
        );
        const [cases] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM credit_repair_cases WHERE client_id = ?`,
          [id],
        );
        for (const row of cases) {
          await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
            row.id,
          ]);
        }
      }
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds,
      });
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("rejects empty body and invalid date", async () => {
    const { caseId } = await seedCompletedCase();
    const empty = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);

    const badDate = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ next_dispute_target_date: "not-a-date" });
    expect(badDate.status).toBe(400);
  }, 30_000);

  it("422 when max_rounds is below highest published", async () => {
    const { caseId } = await seedCompletedCase({
      publishedRounds: 6,
      maxRounds: 8,
    });
    const res = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ max_rounds: 5 });
    expect(res.status).toBe(422);
    expect(res.body.highest_published_round).toBe(6);
  }, 30_000);

  it("raises max_rounds, sets dispute date, reopens completed → round_5", async () => {
    const { clientId, caseId } = await seedCompletedCase({
      publishedRounds: 5,
      maxRounds: 5,
    });
    const target = ymdOffset(10);

    const res = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        max_rounds: 8,
        next_dispute_target_date: target,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.case.max_rounds).toBe(8);
    expect(res.body.case.next_dispute_target_date).toBe(target);
    expect(res.body.case.highest_published_round).toBe(5);
    expect(res.body.case.reopened_to_round_5).toBe(true);
    expect(res.body.case.pipeline_stage).toBe("round_5");
    expect(res.body.case.is_extended).toBe(true);
    expect(res.body.case.available_rounds).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(String(res.body.case.extended_rounds_legend || "")).toMatch(
      /Special/,
    );

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage, max_rounds, next_dispute_target_date
       FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("round_5");
    expect(Number(cases[0].max_rounds)).toBe(8);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(clients[0].pipeline_stage).toBe("round_5");

    const [hist] = await pool.query<RowDataPacket[]>(
      `SELECT from_stage, to_stage, notes FROM client_pipeline_history
       WHERE client_id = ? AND to_stage = 'round_5'
       ORDER BY id DESC LIMIT 1`,
      [clientId],
    );
    expect(hist[0]?.from_stage).toBe("completed");
    expect(String(hist[0]?.notes || "")).toMatch(/Extended rounds/i);

    const from = ymdOffset(0);
    const to = ymdOffset(20);
    const cal = await request(app)
      .get(`/api/admin/calendar`)
      .query({ from, to })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cal.status).toBe(200);
    const ext = (cal.body.round_events as any[]).find(
      (e) => e.case_id === caseId && e.kind === "extended",
    );
    expect(ext).toBeTruthy();
    expect(ext.id).toBe(`${caseId}-extended-target`);
    expect(ext.target_date).toBe(target);
    expect(ext.round_number).toBe(6);

    const dash = await request(app)
      .get(`/api/admin/dashboard`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(dash.status).toBe(200);
    const dashHit = (dash.body.upcoming_rounds as any[]).find(
      (r) => r.case_id === caseId && r.kind === "extended",
    );
    expect(dashHit).toBeTruthy();
    expect(dashHit.id).toBe(`${caseId}-extended-target`);
    expect(dashHit.target_date).toBe(target);
  }, 60_000);

  it("does not reopen when max equals highest published", async () => {
    const { caseId } = await seedCompletedCase({
      publishedRounds: 5,
      maxRounds: 5,
    });
    // Raise then set max equal to published after publishing would stay completed;
    // here: completed with published=5, set max=5 again → no reopen.
    const res = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ max_rounds: 5 });
    expect(res.status).toBe(200);
    expect(res.body.case.reopened_to_round_5).toBe(false);
    expect(res.body.case.pipeline_stage).toBe("completed");
  }, 30_000);

  it("updates report_compare_mode to chain and back to baseline", async () => {
    const { caseId } = await seedCompletedCase({
      publishedRounds: 1,
      maxRounds: 5,
    });
    const chain = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ report_compare_mode: "chain" });
    expect(chain.status).toBe(200);
    expect(chain.body.case.report_compare_mode).toBe("chain");

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT report_compare_mode FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(rows[0].report_compare_mode).toBe("chain");

    const baseline = await request(app)
      .patch(`/api/admin/cases/${caseId}/extended-rounds`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ report_compare_mode: "baseline" });
    expect(baseline.status).toBe(200);
    expect(baseline.body.case.report_compare_mode).toBe("baseline");
  }, 30_000);
});
