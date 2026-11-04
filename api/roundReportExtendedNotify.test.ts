/**
 * Regression (Lecca, Oct 20 2026 — Maria I. Montero): Rounds 6–12 share the
 * round_extended_complete flow. Publishing R6…R10 back-to-back, the 10-minute
 * duplicate guard (flow + client only) silently skipped R7–R10. The guard is
 * now per round, and the SMS prints the real round (not "extended").
 */
import "dotenv/config";
import type { ResultSetHeader } from "mysql2/promise";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reminderFlowRanRecently, reminderTriggerForRoundInline, smsClientReminderBody } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `round-ext-notify-${Date.now()}`;

describe("extended rounds share one flow", () => {
  it("R1–5 have their own trigger; R6+ share round_extended_complete", () => {
    expect(reminderTriggerForRoundInline(5)).toBe("round_5_complete");
    expect(reminderTriggerForRoundInline(7)).toBe("round_extended_complete");
    expect(reminderTriggerForRoundInline(12)).toBe("round_extended_complete");
  });

  it("SMS prints the real round number for extended rounds", () => {
    const en = smsClientReminderBody({ triggerEvent: "round_extended_complete", firstName: "Maria", lang: "en", portalUrl: "https://x/r", roundNumber: 7 });
    expect(en).toContain("Round 7 report");
    expect(en).not.toMatch(/extended/i);
    const es = smsClientReminderBody({ triggerEvent: "round_extended_complete", firstName: "Maria", lang: "es", portalUrl: "https://x/r", roundNumber: 9 });
    expect(es).toContain("Ronda 9");
    // R1–5 unchanged without an explicit round.
    expect(smsClientReminderBody({ triggerEvent: "round_3_complete", firstName: "A", lang: "en", portalUrl: "u" })).toContain("Round 3 report");
  });
});

describe("reminderFlowRanRecently — duplicate guard is per round", () => {
  let pool: mysql.Pool;
  // The live round_extended_complete flow (FK) + a throwaway test client
  // (purged in afterAll; executions cascade).
  let FLOW_ID = 0;
  let CLIENT_ID = 0;

  beforeAll(async () => {
    pool = createIntegrationTestPool();
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'Round', ?, 'en', 'active', 'round_5')`,
      [`vitest+${RUN_ID}@example.com`, RUN_ID],
    );
    CLIENT_ID = Number(c.insertId);
    const [f]: any = await pool.query(`SELECT id FROM reminder_flows WHERE trigger_event = 'round_extended_complete' LIMIT 1`);
    FLOW_ID = Number(f[0].id);
    await pool.query(`DELETE FROM reminder_flow_executions WHERE flow_id = ? AND client_id = ?`, [FLOW_ID, CLIENT_ID]);
    // Round 6 just ran; a non-round run of the same flow too.
    await pool.query(
      `INSERT INTO reminder_flow_executions (flow_id, client_id, round_number, status) VALUES (?, ?, 6, 'completed'), (?, ?, NULL, 'completed')`,
      [FLOW_ID, CLIENT_ID, FLOW_ID, CLIENT_ID],
    );
  }, 30_000);

  afterAll(async () => {
    if (pool) {
      await cleanupIntegrationTestClients(pool, { runId: RUN_ID, clientIds: CLIENT_ID ? [CLIENT_ID] : [] });
      await pool.end();
    }
  });

  it("same round within 10 min is a duplicate", async () => {
    expect(await reminderFlowRanRecently(FLOW_ID, CLIENT_ID, 6)).toBe(true);
  });
  it("a different round (R7 right after R6) is NOT a duplicate", async () => {
    expect(await reminderFlowRanRecently(FLOW_ID, CLIENT_ID, 7)).toBe(false);
    expect(await reminderFlowRanRecently(FLOW_ID, CLIENT_ID, 10)).toBe(false);
  });
  it("non-round flows keep the old behavior (NULL matches NULL)", async () => {
    expect(await reminderFlowRanRecently(FLOW_ID, CLIENT_ID, null)).toBe(true);
    expect(await reminderFlowRanRecently(FLOW_ID, CLIENT_ID, null)).toBe(true);
  });
});
