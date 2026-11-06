/**
 * Shared cleanup for API integration tests that seed rows into the shared TiDB.
 *
 * Usage in every suite that inserts clients/affiliates:
 *
 *   afterAll(async () => {
 *     // …suite-specific deletes (admins, sessions)…
 *     await cleanupIntegrationTestFixtures(pool, { runId: RUN_ID, clientIds, applicationIds });
 *     await pool?.end();
 *   });
 *
 * Funding suites must pass applicationIds and/or runId — client DELETE alone leaves
 * funding_applications on the admin board (FK client_id is ON DELETE SET NULL).
 *
 * Ops purge (all leftover test emails + related orphans):
 *   npm run test:cleanup-fixtures
 *   npm run test:cleanup-fixtures -- --dry-run
 *   npx tsx scripts/scan-integration-test-orphans.ts
 *
 * Removes integration-test clients AND orphaned funding_applications (FK is
 * ON DELETE SET NULL on client_id — deleting clients alone leaves board junk),
 * plus referrers, labels, tickets, MCP vitest OAuth clients, +1555 phones, etc.
 * Safe domains only: @example.test, @affiliate.test, and @example.com used by
 * report-wizard seeds. Never match real customer emails.
 *
 * IMPORTANT: Always pass `{ runId: RUN_ID }` to cleanup helpers — never a bare
 * string. `resolveCleanupRunId` accepts strings for compat but wrong/missing
 * args throw instead of silently leaving fixtures.
 */
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import crypto from "crypto";

/** Safe mailbox domains used only by vitest / manual debug seeds. */
export const INTEGRATION_TEST_EMAIL_SUFFIXES = [
  "@example.test",
  "@affiliate.test",
] as const;

/** Broader purge domains (includes report-wizard @example.com seeds). */
export const INTEGRATION_TEST_PURGE_EMAIL_SUFFIXES = [
  ...INTEGRATION_TEST_EMAIL_SUFFIXES,
  "@example.com",
] as const;

export function isIntegrationTestEmail(email: string | null | undefined): boolean {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return INTEGRATION_TEST_EMAIL_SUFFIXES.some((suffix) => e.endsWith(suffix));
}

/** Unique +1555… E.164 for parallel integration tests (avoids uk_admin_phone_e164 collisions). */
export function uniqueTestE164(seed?: string): string {
  const buf = crypto
    .createHash("sha256")
    .update(seed ?? `${process.pid}-${Date.now()}-${Math.random()}`)
    .digest();
  const n = buf.readUInt32BE(0) % 10_000_000;
  return `+1555${String(n).padStart(7, "0")}`;
}

/** TiDB-safe pool for integration tests (keepAlive + connect timeout). */
export function createIntegrationTestPool(): Pool {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    // Parallel vitest files share TiDB; 2 was too low under cron+hub load.
    connectionLimit: 5,
    queueLimit: 0,
    timezone: "+00:00",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 60_000,
  });
  // TiDB Serverless sometimes drops a socket mid-run (read ECONNRESET). Retry pool-level
  // queries on those codes so one network blip doesn't fail a suite or its cleanup.
  // Connections taken with getConnection() (transactions) are not retried.
  const query = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
  const execute = pool.execute.bind(pool) as (...a: unknown[]) => Promise<unknown>;
  (pool as any).query = (...a: unknown[]) => withDbRetry(() => query(...a));
  (pool as any).execute = (...a: unknown[]) => withDbRetry(() => execute(...a));
  return pool;
}

/**
 * Shared CRON_SECRET for integration suites that call /api/cron/*.
 * Parallel vitest workers mutate process.env — unique per-file secrets race
 * and cause flaky 401s. All cron suites must use this exact value.
 */
export const VITEST_CRON_SECRET = "vitest-cron-shared";


function isRetriableDbError(err: unknown): boolean {
  const code = String((err as NodeJS.ErrnoException)?.code || "");
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNREFUSED"
  );
}

/** Retry transient TiDB connect/query flakes during parallel vitest runs. */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriableDbError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

const TEST_EMAIL_SUFFIXES = INTEGRATION_TEST_PURGE_EMAIL_SUFFIXES;

export type CleanupRunOpts = {
  runId: string;
  clientIds?: number[];
  applicationIds?: number[];
  affiliateIds?: number[];
};

/**
 * Normalize cleanup args. Historically callers sometimes passed a bare RUN_ID
 * string; that used to silently become LIKE '%undefined%' and leave TiDB junk.
 * Accept string for backward compatibility (with a warning) and throw on garbage.
 */
export function resolveCleanupRunId(
  opts: string | { runId?: unknown } | null | undefined,
  label: string,
): string {
  if (typeof opts === "string") {
    if (!opts.trim()) {
      throw new Error(
        `[testDbCleanup] ${label}: empty runId string — refusing cleanup`,
      );
    }
    console.warn(
      `[testDbCleanup] ${label}: pass { runId: "…" }, not a bare string (compat path)`,
    );
    return opts;
  }
  const runId =
    opts && typeof opts === "object" ? String(opts.runId ?? "").trim() : "";
  if (!runId) {
    throw new Error(
      `[testDbCleanup] ${label}: expected { runId: string } (got ${JSON.stringify(opts)}). ` +
        `Bare/missing runId previously left integration fixtures in TiDB.`,
    );
  }
  return runId;
}

export async function cleanupIntegrationTestClients(
  pool: Pool,
  opts: string | { runId: string; clientIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestClients");
  const clientIds =
    typeof opts === "object" && opts ? opts.clientIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((clientIds ?? []).map(Number).filter((id) => id > 0)),
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
      [`%${runId}%`, `%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }

  // Phone-only fixtures (optionalEmail / adminAiTools) — match by last_name/run stamp in phone.
  const [phoneOnly] = await pool.query<ResultSetHeader>(
    `DELETE FROM clients
     WHERE (email IS NULL OR email = '')
       AND (phone LIKE ? OR last_name LIKE ? OR first_name LIKE ?)`,
    [`%${runId}%`, `%${runId}%`, `%${runId}%`],
  );
  deleted += Number(phoneOnly.affectedRows ?? 0);

  return deleted;
}

/** Delete funding_applications (+ linked docs) created by a test run. */
export async function cleanupIntegrationTestFundingApplications(
  pool: Pool,
  opts: string | { runId: string; applicationIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(
    opts,
    "cleanupIntegrationTestFundingApplications",
  );
  const applicationIds =
    typeof opts === "object" && opts ? opts.applicationIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((applicationIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    const [docs] = await pool.query<ResultSetHeader>(
      `DELETE FROM client_documents WHERE funding_application_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(docs.affectedRows ?? 0);
    const [apps] = await pool.query<ResultSetHeader>(
      `DELETE FROM funding_applications WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(apps.affectedRows ?? 0);
  }

  for (const suffix of TEST_EMAIL_SUFFIXES) {
    const [docs] = await pool.query<ResultSetHeader>(
      `DELETE cd FROM client_documents cd
       INNER JOIN funding_applications fa ON fa.id = cd.funding_application_id
       WHERE fa.email LIKE ? AND fa.email LIKE ?`,
      [`%${runId}%`, `%${suffix}`],
    );
    deleted += Number(docs.affectedRows ?? 0);
    const [apps] = await pool.query<ResultSetHeader>(
      `DELETE FROM funding_applications WHERE email LIKE ? AND email LIKE ?`,
      [`%${runId}%`, `%${suffix}`],
    );
    deleted += Number(apps.affectedRows ?? 0);
  }
  return deleted;
}

/** Standard afterAll for suites that seed clients and/or funding applications. */
export async function cleanupIntegrationTestFixtures(
  pool: Pool,
  opts: string | CleanupRunOpts,
): Promise<void> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestFixtures");
  const clientIds =
    typeof opts === "object" && opts ? opts.clientIds : undefined;
  const applicationIds =
    typeof opts === "object" && opts ? opts.applicationIds : undefined;
  await cleanupIntegrationTestFundingApplications(pool, {
    runId,
    applicationIds,
  });
  await cleanupIntegrationTestClients(pool, { runId, clientIds });
  await cleanupIntegrationTestReferrers(pool, { runId });
  await cleanupIntegrationTestLabels(pool, { runId });
  await cleanupIntegrationTestTickets(pool, { runId });
}

/**
 * Delete ephemeral vitest admin rows (and sessions/notifications).
 * Safe for @example.test / @affiliate.test only — never pass real staff ids.
 */
export async function cleanupIntegrationTestAdmins(
  pool: Pool,
  adminIds: number[],
): Promise<number> {
  const ids = [
    ...new Set(adminIds.map(Number).filter((id) => id > 0)),
  ];
  if (!ids.length) return 0;
  const ph = ids.map(() => "?").join(",");
  // Only delete if email is a known test domain (defense against bad ids).
  const [allowed] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM admins
     WHERE id IN (${ph})
       AND (
         LOWER(TRIM(COALESCE(email, ''))) LIKE '%@example.test'
         OR LOWER(TRIM(COALESCE(email, ''))) LIKE '%@affiliate.test'
       )`,
    ids,
  );
  const safeIds = allowed.map((r) => Number(r.id)).filter((id) => id > 0);
  if (!safeIds.length) return 0;
  const sph = safeIds.map(() => "?").join(",");
  await pool
    .query(`DELETE FROM admin_sessions WHERE admin_id IN (${sph})`, safeIds)
    .catch(() => {});
  await pool
    .query(
      `DELETE FROM admin_notifications WHERE admin_id IN (${sph})`,
      safeIds,
    )
    .catch(() => {});
  await pool
    .query(
      `DELETE FROM admin_phone_numbers WHERE assigned_admin_id IN (${sph})`,
      safeIds,
    )
    .catch(() => {});
  const [r] = await pool.query<ResultSetHeader>(
    `DELETE FROM admins WHERE id IN (${sph})`,
    safeIds,
  );
  return Number(r.affectedRows ?? 0);
}

export async function cleanupIntegrationTestAffiliates(
  pool: Pool,
  opts: string | { runId: string; affiliateIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestAffiliates");
  const affiliateIds =
    typeof opts === "object" && opts ? opts.affiliateIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((affiliateIds ?? []).map(Number).filter((id) => id > 0)),
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
      [`%${runId}%`, `%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  return deleted;
}

export async function cleanupIntegrationTestReferrers(
  pool: Pool,
  opts: string | { runId: string; referrerIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestReferrers");
  const referrerIds =
    typeof opts === "object" && opts ? opts.referrerIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((referrerIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM referrers WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  for (const suffix of ["@example.test", "@affiliate.test"] as const) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM referrers WHERE email LIKE ? AND email LIKE ?`,
      [`%${runId}%`, `%${suffix}`],
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  const [byName] = await pool.query<ResultSetHeader>(
    `DELETE FROM referrers WHERE last_name LIKE ? OR first_name LIKE ?`,
    [`%${runId}%`, `%${runId}%`],
  );
  deleted += Number(byName.affectedRows ?? 0);
  return deleted;
}

export async function cleanupIntegrationTestLabels(
  pool: Pool,
  opts: string | { runId: string; labelIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestLabels");
  const labelIds =
    typeof opts === "object" && opts ? opts.labelIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((labelIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    await pool.query(
      `DELETE FROM client_labels WHERE label_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM labels WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  await pool.query(
    `DELETE cl FROM client_labels cl
     INNER JOIN labels l ON l.id = cl.label_id
     WHERE l.slug LIKE ?`,
    [`%${runId}%`],
  );
  const [bySlug] = await pool.query<ResultSetHeader>(
    `DELETE FROM labels WHERE slug LIKE ?`,
    [`%${runId}%`],
  );
  deleted += Number(bySlug.affectedRows ?? 0);
  return deleted;
}

export async function cleanupIntegrationTestTickets(
  pool: Pool,
  opts: string | { runId: string; ticketIds?: number[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestTickets");
  const ticketIds =
    typeof opts === "object" && opts ? opts.ticketIds : undefined;
  let deleted = 0;
  const ids = [
    ...new Set((ticketIds ?? []).map(Number).filter((id) => id > 0)),
  ];
  if (ids.length > 0) {
    await pool.query(
      `DELETE FROM support_ticket_replies WHERE ticket_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM support_tickets WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    deleted += Number(r.affectedRows ?? 0);
  }
  await pool.query(
    `DELETE r FROM support_ticket_replies r
     INNER JOIN support_tickets t ON t.id = r.ticket_id
     WHERE t.subject LIKE ?`,
    [`%${runId}%`],
  );
  const [bySub] = await pool.query<ResultSetHeader>(
    `DELETE FROM support_tickets WHERE subject LIKE ?`,
    [`%${runId}%`],
  );
  deleted += Number(bySub.affectedRows ?? 0);
  return deleted;
}

/** Delete MCP OAuth clients/codes/tokens for a test run (safe vitest- prefixes only). */
export async function cleanupIntegrationTestMcpOAuth(
  pool: Pool,
  opts: string | { runId: string; clientIds?: string[] },
): Promise<number> {
  const runId = resolveCleanupRunId(opts, "cleanupIntegrationTestMcpOAuth");
  const extraIds =
    typeof opts === "object" && opts ? opts.clientIds ?? [] : [];
  const patterns = [
    `vitest-${runId}%`,
    `vitest-deny-${runId}%`,
    `claude-vitest-${runId}%`,
    ...extraIds.filter(Boolean),
  ];
  let deleted = 0;
  for (const pattern of patterns) {
    const isExact = !pattern.includes("%");
    await pool.query(
      isExact
        ? `DELETE FROM mcp_oauth_codes WHERE client_id = ?`
        : `DELETE FROM mcp_oauth_codes WHERE client_id LIKE ?`,
      [pattern],
    );
    await pool.query(
      isExact
        ? `DELETE FROM mcp_oauth_tokens WHERE client_id = ?`
        : `DELETE FROM mcp_oauth_tokens WHERE client_id LIKE ?`,
      [pattern],
    );
    const [r] = await pool.query<ResultSetHeader>(
      isExact
        ? `DELETE FROM mcp_oauth_clients WHERE client_id = ?`
        : `DELETE FROM mcp_oauth_clients WHERE client_id LIKE ?`,
      [pattern],
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
  // Phone-only +1555 fixtures (never match real customer phones in this range).
  const [phoneOnly] = await pool.query<ResultSetHeader>(
    `DELETE FROM clients
     WHERE phone LIKE '+1555%' AND (email IS NULL OR email = '')`,
  );
  deleted += Number(phoneOnly.affectedRows ?? 0);
  return deleted;
}

/** Purge funding_applications seeded by integration tests / manual debug (@example.test). */
export async function purgeAllIntegrationTestFundingApplications(
  pool: Pool,
): Promise<number> {
  let deleted = 0;
  for (const suffix of TEST_EMAIL_SUFFIXES) {
    const [docs] = await pool.query<ResultSetHeader>(
      `DELETE cd FROM client_documents cd
       INNER JOIN funding_applications fa ON fa.id = cd.funding_application_id
       WHERE fa.email LIKE ?`,
      [`%${suffix}`],
    );
    deleted += Number(docs.affectedRows ?? 0);
    const [apps] = await pool.query<ResultSetHeader>(
      `DELETE FROM funding_applications WHERE email LIKE ?`,
      [`%${suffix}`],
    );
    deleted += Number(apps.affectedRows ?? 0);
  }
  return deleted;
}

/** Ops purge for non-client tables that suites can orphan. */
export async function purgeAllIntegrationTestOrphans(
  pool: Pool,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const bump = (key: string, n: number) => {
    counts[key] = (counts[key] ?? 0) + n;
  };

  // Referrers
  for (const suffix of ["@example.test", "@affiliate.test"] as const) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM referrers WHERE email LIKE ?`,
      [`%${suffix}`],
    );
    bump("referrers", Number(r.affectedRows ?? 0));
  }

  // Labels from pipeline filter suites
  await pool.query(
    `DELETE cl FROM client_labels cl
     INNER JOIN labels l ON l.id = cl.label_id
     WHERE l.slug LIKE 'pipe_lbl_%' OR l.slug LIKE 'vitest_%'`,
  );
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM labels WHERE slug LIKE 'pipe_lbl_%' OR slug LIKE 'vitest_%'`,
    );
    bump("labels", Number(r.affectedRows ?? 0));
  }

  // Tickets left when client delete failed mid-suite
  await pool.query(
    `DELETE r FROM support_ticket_replies r
     INNER JOIN support_tickets t ON t.id = r.ticket_id
     WHERE t.subject LIKE '%gridpg-%' OR t.subject LIKE '%@example.test%'`,
  );
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM support_tickets
       WHERE subject LIKE '%gridpg-%' OR subject LIKE '%@example.test%'`,
    );
    bump("support_tickets", Number(r.affectedRows ?? 0));
  }

  // Notify extras
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM admin_notify_extra_emails WHERE email LIKE '%@example.test'`,
    );
    bump("admin_notify_extra_emails", Number(r.affectedRows ?? 0));
  }

  // MCP OAuth vitest clients (+ codes/tokens for those client_ids)
  {
    const [mcpRows] = await pool.query<
      import("mysql2/promise").RowDataPacket[]
    >(
      `SELECT client_id FROM mcp_oauth_clients
       WHERE client_id LIKE 'vitest-%'
          OR client_id LIKE 'claude-vitest-%'
          OR client_name IN ('deny-test', 'claude-ok')`,
    );
    const mcpIds = (mcpRows as Array<{ client_id: string }>)
      .map((r) => String(r.client_id))
      .filter(Boolean);
    if (mcpIds.length > 0) {
      const ph = mcpIds.map(() => "?").join(",");
      await pool.query(
        `DELETE FROM mcp_oauth_codes WHERE client_id IN (${ph})`,
        mcpIds,
      );
      await pool.query(
        `DELETE FROM mcp_oauth_tokens WHERE client_id IN (${ph})`,
        mcpIds,
      );
      const [r] = await pool.query<ResultSetHeader>(
        `DELETE FROM mcp_oauth_clients WHERE client_id IN (${ph})`,
        mcpIds,
      );
      bump("mcp_oauth_clients", Number(r.affectedRows ?? 0));
    }
  }

  // CRM contacts seeded by tests (@example.test / @affiliate.test) + threads.
  {
    const testContacts = `SELECT id FROM contacts
       WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'`;
    await pool.query(
      `DELETE FROM conversation_messages WHERE conversation_id IN (
         SELECT id FROM conversations WHERE contact_id IN (${testContacts}))`,
    );
    await pool.query(`DELETE FROM conversations WHERE contact_id IN (${testContacts})`);
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM contacts WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'`,
    );
    bump("contacts", Number(r.affectedRows ?? 0));
  }

  // Test OFG numbers + unknown contacts (+1555 only)
  await pool.query(
    `DELETE FROM conversation_unknown_contacts WHERE phone_e164 LIKE '+1555%'`,
  );
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM admin_phone_numbers
       WHERE e164 LIKE '+1555%'
          OR friendly_name LIKE 'Vitest%'
          OR friendly_name LIKE 'AI tools OFG%'`,
    );
    bump("admin_phone_numbers", Number(r.affectedRows ?? 0));
  }

  // Ephemeral task templates
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM onboarding_task_templates
       WHERE slug LIKE 'optional_reopen_%' AND is_system = 0`,
    );
    bump("onboarding_task_templates", Number(r.affectedRows ?? 0));
  }

  // Work tasks with clear test titles
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM admin_work_tasks
       WHERE title LIKE 'AI tools task%'
          OR title LIKE '%wt-case-%'
          OR title LIKE '%vitest%'`,
    );
    bump("admin_work_tasks", Number(r.affectedRows ?? 0));
  }

  // Affiliates test emails
  for (const suffix of ["@example.test", "@affiliate.test"] as const) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM affiliates WHERE email LIKE ?`,
      [`%${suffix}`],
    );
    bump("affiliates", Number(r.affectedRows ?? 0));
  }

  // Ephemeral @example.test admins (never touch real staff domains)
  {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM admins WHERE email LIKE '%@example.test'`,
    );
    bump("admins", Number(r.affectedRows ?? 0));
  }

  return counts;
}
