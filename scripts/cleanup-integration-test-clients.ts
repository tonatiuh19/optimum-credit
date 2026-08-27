/**
 * Purge leftover integration-test fixtures from the shared DB.
 *
 *   npx tsx scripts/cleanup-integration-test-clients.ts
 *   npx tsx scripts/cleanup-integration-test-clients.ts --dry-run
 *
 * Deletes clients whose email ends with @example.test, @affiliate.test, or
 * @example.com (wizard seeds), plus matching funding_applications, referrers,
 * labels, tickets, MCP OAuth vitest clients, +1555 phones, etc.
 * Cascades cases/tasks/payments via FKs on clients.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import {
  purgeAllIntegrationTestClients,
  purgeAllIntegrationTestFundingApplications,
  purgeAllIntegrationTestOrphans,
} from "../api/testDbCleanup";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.DB_HOST) {
    console.error("DB_HOST required (.env)");
    process.exit(1);
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectionLimit: 2,
  });

  try {
    const previews: Array<[string, string]> = [
      [
        "clients",
        `SELECT COUNT(*) AS c FROM clients
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'
            OR email LIKE '%@example.com'
            OR (phone LIKE '+1555%' AND (email IS NULL OR email = ''))`,
      ],
      [
        "funding_applications",
        `SELECT COUNT(*) AS c FROM funding_applications
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'
            OR email LIKE '%@example.com'`,
      ],
      [
        "referrers",
        `SELECT COUNT(*) AS c FROM referrers
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'`,
      ],
      [
        "labels",
        `SELECT COUNT(*) AS c FROM labels
         WHERE slug LIKE 'pipe_lbl_%' OR slug LIKE 'vitest_%'`,
      ],
      [
        "mcp_oauth_clients",
        `SELECT COUNT(*) AS c FROM mcp_oauth_clients
         WHERE client_id LIKE 'vitest-%' OR client_id LIKE 'claude-vitest-%'`,
      ],
      [
        "admin_phone_numbers +1555/Vitest",
        `SELECT COUNT(*) AS c FROM admin_phone_numbers
         WHERE e164 LIKE '+1555%' OR friendly_name LIKE 'Vitest%'
            OR friendly_name LIKE 'AI tools OFG%'`,
      ],
      [
        "admins @example.test",
        `SELECT COUNT(*) AS c FROM admins WHERE email LIKE '%@example.test'`,
      ],
      [
        "affiliates test emails",
        `SELECT COUNT(*) AS c FROM affiliates
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'`,
      ],
    ];

    console.log("Preview counts:");
    for (const [label, sql] of previews) {
      try {
        const [rows] = await pool.query(sql);
        const c = Number((rows as Array<{ c: number }>)[0]?.c ?? 0);
        console.log(`  ${label}: ${c}`);
      } catch (err) {
        console.log(`  ${label}: ERR ${(err as Error).message}`);
      }
    }

    if (dryRun) {
      console.log("Dry run — no deletes.");
      return;
    }

    const fundDeleted = await purgeAllIntegrationTestFundingApplications(pool);
    console.log(
      `Deleted ${fundDeleted} funding application / funding doc row(s).`,
    );
    const orphanCounts = await purgeAllIntegrationTestOrphans(pool);
    for (const [k, v] of Object.entries(orphanCounts)) {
      if (v > 0) console.log(`Deleted ${v} ${k} row(s).`);
    }
    const deleted = await purgeAllIntegrationTestClients(pool);
    console.log(`Deleted ${deleted} client row(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
