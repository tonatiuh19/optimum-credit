/**
 * Purge leftover integration-test clients from the shared DB.
 *
 *   npx tsx scripts/cleanup-integration-test-clients.ts
 *   npx tsx scripts/cleanup-integration-test-clients.ts --dry-run
 *
 * Deletes clients whose email ends with @example.test, @affiliate.test, or
 * @example.com (wizard seeds). Cascades cases/tasks/payments via FKs.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { purgeAllIntegrationTestClients } from "../api/testDbCleanup";

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
    const [rows] = await pool.query(
      `SELECT id, first_name, last_name, email, status, pipeline_stage, created_at
       FROM clients
       WHERE email LIKE '%@example.test'
          OR email LIKE '%@affiliate.test'
          OR email LIKE '%@example.com'
       ORDER BY id DESC
       LIMIT 200`,
    );
    const list = rows as Array<Record<string, unknown>>;
    console.log(`Found ${list.length} matching client(s) (showing up to 200):`);
    for (const r of list) {
      console.log(
        `  #${r.id} ${r.first_name} ${r.last_name} <${r.email}> ${r.status}/${r.pipeline_stage}`,
      );
    }
    if (dryRun) {
      console.log("Dry run — no deletes.");
      return;
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
