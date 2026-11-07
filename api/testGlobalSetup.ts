/**
 * Vitest global setup for the suites that write to the shared TiDB (Nov 7, 2026; same approach as groundwork).
 *
 * - One run at a time: a DB-wide lock (GET_LOCK) is held for the whole run, so a second run (another
 *   terminal, a deploy) waits instead of overlapping. Overlapping runs purge each other's fixtures
 *   mid-run (random 401s / missing rows / FK errors that look like flaky tests).
 * - Before the run: fixtures left by a killed run (Ctrl+C, crash — its afterAll never ran) are purged,
 *   so they cannot collide with this run's data.
 * - After the run: everything that looks like a test fixture is purged, so staff never see test rows
 *   even when a suite's own cleanup missed something.
 */
import "dotenv/config";
import {
  createIntegrationTestPool,
  purgeAllIntegrationTestClients,
  purgeAllIntegrationTestFundingApplications,
  purgeAllIntegrationTestOrphans,
} from "./testDbCleanup";

export const TEST_RUN_LOCK = "optimum_credit_vitest_run";
const RUN_LOCK_WAIT_S = 30 * 60;

async function purgeAll(label: string) {
  const pool = createIntegrationTestPool();
  try {
    const funding = await purgeAllIntegrationTestFundingApplications(pool);
    const orphans = await purgeAllIntegrationTestOrphans(pool);
    const clients = await purgeAllIntegrationTestClients(pool);
    const n = funding + clients + Object.values(orphans).reduce((a, b) => a + Number(b || 0), 0);
    if (n) console.warn(`[test-db] ${label}: purged ${n} leftover test row(s)`);
  } catch (e) {
    console.warn(`[test-db] ${label}: purge failed — ${(e as Error).message}`);
  } finally {
    await pool.end();
  }
}

export default async function setup() {
  if (!process.env.DB_HOST) return;

  // Hold the run lock on a dedicated connection until teardown.
  const lockPool = createIntegrationTestPool();
  const lockConn = await lockPool.getConnection();
  const [[got]] = (await lockConn.query(`SELECT GET_LOCK(?, 0) AS l`, [TEST_RUN_LOCK])) as any;
  if (Number(got?.l) !== 1) {
    console.warn(`[test-db] another test run is using the shared DB; waiting for it to finish (up to ${RUN_LOCK_WAIT_S / 60} min)…`);
    const [[waited]] = (await lockConn.query(`SELECT GET_LOCK(?, ?) AS l`, [TEST_RUN_LOCK, RUN_LOCK_WAIT_S])) as any;
    if (Number(waited?.l) !== 1) {
      lockConn.release();
      await lockPool.end();
      throw new Error("[test-db] timed out waiting for another test run on the shared DB");
    }
  }
  // Keep the lock's connection busy so the gateway never drops it (a dropped connection frees the lock).
  const keepAlive = setInterval(() => void lockConn.query("SELECT 1").catch(() => undefined), 30_000);
  keepAlive.unref?.();

  // We own the DB: anything that looks like a fixture belongs to a dead run.
  await purgeAll("before the run");

  return async function teardown() {
    clearInterval(keepAlive);
    try {
      await purgeAll("after the run");
    } finally {
      await lockConn.query(`SELECT RELEASE_LOCK(?)`, [TEST_RUN_LOCK]).catch(() => undefined);
      lockConn.release();
      await lockPool.end().catch(() => undefined);
    }
  };
}
