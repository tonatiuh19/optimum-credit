/**
 * Shared cleanup for API integration tests that seed rows into the shared TiDB.
 *
 * Usage in every suite that inserts clients/affiliates:
 *
 *   afterAll(async () => {
 *     // …suite-specific deletes…
 *     await cleanupIntegrationTestClients(pool, { runId: RUN_ID, clientIds });
 *     await pool?.end();
 *   });
 *
 * Always sweep by RUN_ID email pattern in addition to explicit ids — suites that
 * overwrite a single `clientId` (or abort mid-run) otherwise leave MuteBoth /
 * Prefs-* style fixtures on the Pipeline board.
 *
 * Ops purge (all leftover test emails):
 *   npm run test:cleanup-fixtures
 *   npm run test:cleanup-fixtures -- --dry-run
 *
 * Safe domains only: @example.test, @affiliate.test, and @example.com used by
 * report-wizard seeds. Never match real customer emails.
 */
import type { Pool, ResultSetHeader } from "mysql2/promise";

const TEST_EMAIL_SUFFIXES = [
  "@example.test",
  "@affiliate.test",
  "@example.com",
] as const;

export async function cleanupIntegrationTestClients(
  pool: Pool,
  opts: {
    runId: string;
    clientIds?: number[];
  },
): Promise<number> {
  let deleted = 0;
  const ids = [
    ...new Set((opts.clientIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM clients WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(r.affectedRows ?? 0);
  }

  for (const suffix of TEST_EMAIL_SUFFIXES) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM clients WHERE email LIKE ? AND email LIKE ?`,
      [`%${opts.runId}%`, `%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  return deleted;
}

export async function cleanupIntegrationTestAffiliates(
  pool: Pool,
  opts: {
    runId: string;
    affiliateIds?: number[];
  },
): Promise<number> {
  let deleted = 0;
  const ids = [
    ...new Set((opts.affiliateIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM affiliates WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  for (const suffix of ["@example.test", "@affiliate.test"] as const) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM affiliates WHERE email LIKE ? AND email LIKE ?`,
      [`%${opts.runId}%`, `%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  return deleted;
}

/** One-shot purge of all known integration-test client emails (ops / local). */
export async function purgeAllIntegrationTestClients(
  pool: Pool,
): Promise<number> {
  let deleted = 0;
  for (const suffix of TEST_EMAIL_SUFFIXES) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM clients WHERE email LIKE ?`,
      [`%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  return deleted;
}
