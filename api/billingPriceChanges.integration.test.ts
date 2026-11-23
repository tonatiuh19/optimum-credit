/**
 * Scheduled billing price changes against the real tables. Uses its own fake billing actions and
 * far-future months (always filtered with onlyMonths), so real prices and the real 2026-12 change
 * are never touched.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { applyDueBillingPriceChanges } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const RUN = `vbp${Date.now()}`;
const A = `${RUN}_a`;
const B = `${RUN}_b`;
const MAR = "2099-03"; // previous month 2099-02 gets a fake invoice row
const JUN = "2099-06"; // no previous invoice: falls back to one day into the month
let pool: Pool;
let invoiceId = 0;

const price = async (action: string) =>
  Number((await pool.query<RowDataPacket[]>(`SELECT unit_price_usd FROM billing_prices WHERE action = ?`, [action]))[0][0]?.unit_price_usd);
const appliedAt = async (month: string, action: string) =>
  (await pool.query<RowDataPacket[]>(`SELECT applied_at FROM billing_price_changes WHERE effective_month = ? AND action = ?`, [month, action]))[0][0]?.applied_at;

beforeAll(async () => {
  pool = createIntegrationTestPool();
  await pool.query(
    `INSERT INTO billing_prices (action, service, unit, unit_price_usd, billable, sort_order) VALUES (?, 'vitest', 'month', 10, 0, 999), (?, 'vitest', 'month', 20, 0, 999)`,
    [A, B],
  );
  await pool.query(
    `INSERT INTO billing_price_changes (effective_month, action, unit_price_usd, note) VALUES (?, ?, 11.5, 'vitest'), (?, ?, 22.25, 'vitest'), (?, ?, 33, 'vitest')`,
    [MAR, A, MAR, B, JUN, A],
  );
}, 60_000);

afterAll(async () => {
  if (invoiceId) await pool.query(`DELETE FROM billing_invoices WHERE id = ?`, [invoiceId]);
  await pool.query(`DELETE FROM billing_price_changes WHERE action IN (?, ?)`, [A, B]);
  await pool.query(`DELETE FROM billing_prices WHERE action IN (?, ?)`, [A, B]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'billing.price_change_applied' AND changes_json LIKE ?`, [`%${RUN}%`]);
  await pool.end();
}, 60_000);

describe("applyDueBillingPriceChanges", () => {
  it("does nothing before the month starts, or early in the month while last month's invoice is missing", async () => {
    expect(await applyDueBillingPriceChanges(Date.UTC(2099, 1, 28, 23), [MAR])).toEqual({ applied: [] });
    expect(await applyDueBillingPriceChanges(Date.UTC(2099, 2, 1, 0, 3), [MAR])).toEqual({ applied: [] });
    expect(await price(A)).toBe(10);
    expect(await appliedAt(MAR, A)).toBeNull();
  });

  it("applies every price of the month once last month's invoice exists, then keeps them as history", async () => {
    const [ins] = await pool.query<any>(
      `INSERT INTO billing_invoices (period_month, period_start, period_end, lines_json, total_usd, status) VALUES ('2099-02', '2099-02-01', '2099-03-01', '[]', 0, 'paid')`,
    );
    invoiceId = ins.insertId;
    const out = await applyDueBillingPriceChanges(Date.UTC(2099, 2, 1, 0, 6), [MAR]);
    expect(out.applied.sort()).toEqual([`${MAR}:${A}`, `${MAR}:${B}`]);
    expect(await price(A)).toBe(11.5);
    expect(await price(B)).toBe(22.25);
    expect(await appliedAt(MAR, A)).not.toBeNull();
    // Running again (next cron tick, or two at once) never re-applies.
    const again = await Promise.all([applyDueBillingPriceChanges(Date.UTC(2099, 2, 1, 0, 11), [MAR]), applyDueBillingPriceChanges(Date.UTC(2099, 2, 1, 0, 11), [MAR])]);
    expect(again.flatMap((r) => r.applied)).toEqual([]);
  });

  it("without last month's invoice, applies one day into the month (nothing to bill / no Stripe)", async () => {
    expect((await applyDueBillingPriceChanges(Date.UTC(2099, 5, 1, 12), [JUN])).applied).toEqual([]);
    expect((await applyDueBillingPriceChanges(Date.UTC(2099, 5, 2, 0, 1), [JUN])).applied).toEqual([`${JUN}:${A}`]);
    expect(await price(A)).toBe(33);
  });

  it("an empty month filter applies nothing (guard for faked clocks)", async () => {
    expect(await applyDueBillingPriceChanges(Date.UTC(2200, 0, 2), [])).toEqual({ applied: [] });
  });
});
