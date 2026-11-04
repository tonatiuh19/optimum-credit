/**
 * Two rounds without changes (Cesar, Nov 2, 2026): decided only when a report is sent, no cron.
 * Tests the decision against the real tables; never sends an SMS.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { clientHasTwoRoundsWithoutChanges, roundNoChangeAlertAdminIds, roundsHaveNoChanges } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const bs = (tu: [number, number], ex: [number, number] = [0, 0], eq: [number, number] = [0, 0]) => ({
  transunion: { before: tu[0], after: tu[1] },
  experian: { before: ex[0], after: ex[1] },
  equifax: { before: eq[0], after: eq[1] },
});
const row = (items: number | null, scores: unknown) => ({ items_removed: items, bureau_scores_json: scores });

describe("roundsHaveNoChanges", () => {
  it.each([
    ["flat, nothing removed", row(0, bs([600, 620])), row(0, bs([600, 620])), row(1, bs([600, 620])), true],
    ["items removed this round", row(1, bs([600, 620])), row(0, bs([600, 620])), row(0, bs([600, 620])), false],
    ["items removed last round", row(0, bs([600, 620])), row(2, bs([600, 620])), row(0, bs([600, 620])), false],
    ["score gain this round", row(0, bs([600, 625])), row(0, bs([600, 620])), row(0, bs([600, 620])), false],
    ["score gain last round", row(0, bs([600, 620])), row(0, bs([600, 620])), row(0, bs([600, 610])), false],
    ["gain on one bureau only", row(0, bs([600, 620], [600, 615])), row(0, bs([600, 620], [600, 610])), row(0, bs([600, 620], [600, 610])), false],
    ["scores went down", row(0, bs([600, 610])), row(0, bs([600, 620])), row(0, bs([600, 620])), true],
    ["unknown item count is never zero", row(null, bs([600, 620])), row(0, bs([600, 620])), null, false],
    ["no earlier round: prior gain measured from its Before", row(0, bs([600, 620])), row(0, bs([600, 620])), null, false],
    ["no earlier round, flat", row(0, bs([620, 620])), row(0, bs([620, 620])), null, true],
    ["a bureau with No score cannot count as a gain", row(0, bs([600, 620], [0, 0])), row(0, bs([600, 620], [0, 0])), row(0, bs([600, 620], [0, 0])), true],
    ["a bureau that first appears is not a gain", row(0, bs([600, 620], [0, 650])), row(0, bs([600, 620], [0, 0])), row(0, bs([600, 620], [0, 0])), true],
  ] as const)("%s", (_n, cur, prior, earlier, want) => {
    expect(roundsHaveNoChanges(cur as any, prior as any, earlier as any)).toBe(want);
  });
});

describe("recipients", () => {
  it("default Lecca + Cesar; env can change them", () => {
    expect(roundNoChangeAlertAdminIds({} as any)).toEqual([150002, 90001]);
    expect(roundNoChangeAlertAdminIds({ ROUND_NO_CHANGE_ALERT_ADMIN_IDS: "7, x" } as any)).toEqual([7]);
  });
});

describe("clientHasTwoRoundsWithoutChanges", () => {
  let pool: Pool;
  let clientId = 0;
  let caseId = 0;
  const flat = JSON.stringify(bs([620, 620]));
  const seed = async (round: number, o: { items?: number; status?: string | null; engine?: string; startingPoint?: boolean } = {}) => {
    let sid: number | null = null;
    if (o.startingPoint) {
      const [s] = await pool.query<ResultSetHeader>(
        `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, created_by_admin_id)
         VALUES (?, ?, ?, 'published', '{"starting_point":true}', (SELECT id FROM admins ORDER BY id LIMIT 1))`,
        [caseId, clientId, round],
      );
      sid = s.insertId;
    }
    await pool.query(
      `INSERT INTO client_round_reports (client_id, case_id, round_number, items_removed, bureau_scores_json, delivery_status, engine_json, wizard_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, caseId, round, o.items ?? 0, flat, o.status === undefined ? "sent" : o.status, JSON.stringify({ engine: o.engine ?? "progress_report_engine_v1" }), sid],
    );
  };
  const reset = async () => {
    await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
    await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  };

  beforeAll(async () => {
    pool = createIntegrationTestPool();
    const [c] = await pool.query<ResultSetHeader>(`INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('No', 'Change', ?, 'active', 'round_3')`, [`no-change-${Date.now()}@example.test`]);
    clientId = c.insertId;
    const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_3', 'active')`, [clientId]);
    caseId = k.insertId;
  });
  afterAll(async () => {
    await reset();
    await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await pool.end();
  });

  it.each([
    ["two flat sent rounds", [[2, {}], [3, {}]], 3, true],
    ["older report with no status counts as sent", [[2, { status: null }], [3, {}]], 3, true],
    ["Round 1 never alerts", [[1, {}]], 1, false],
    ["a gap: previous round missing", [[1, {}], [3, {}]], 3, false],
    ["previous round still held", [[2, { status: "needs_review" }], [3, {}]], 3, false],
    ["previous round waiting for approval", [[2, { status: "pending_approval" }], [3, {}]], 3, false],
    ["this round is a Score update", [[2, {}], [3, { engine: "score_update" }]], 3, false],
    ["previous round is a Score update", [[2, { engine: "score_update" }], [3, {}]], 3, false],
    ["previous round is a starting point", [[1, { startingPoint: true }], [2, {}]], 2, false],
    ["items removed last round", [[2, { items: 3 }], [3, {}]], 3, false],
  ] as const)("%s", async (_n, rounds, round, want) => {
    await reset();
    for (const [n, o] of rounds) await seed(n, o as any);
    expect(await clientHasTwoRoundsWithoutChanges(clientId, round)).toBe(want);
  }, 60_000);
});
