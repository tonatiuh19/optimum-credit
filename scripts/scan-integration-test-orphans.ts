/**
 * Scan TiDB for leftover integration-test fixtures (read-only).
 *
 *   npx tsx scripts/scan-integration-test-orphans.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
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
    const checks: Array<[string, string, unknown[]]> = [
      [
        "clients @example.test/@affiliate.test",
        `SELECT id, first_name, last_name, email FROM clients
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "clients phone-only +1555 (likely test)",
        `SELECT id, first_name, last_name, phone, email FROM clients
         WHERE phone LIKE '+1555%' AND (email IS NULL OR email = '')
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "funding_applications test emails",
        `SELECT id, email, status FROM funding_applications
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "labels pipe_lbl_/vitest_/test_",
        `SELECT id, slug, name_en FROM labels
         WHERE slug LIKE 'pipe_lbl_%' OR slug LIKE 'vitest_%' OR slug LIKE 'test_%'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "support_tickets gridpg/pipe/example.test",
        `SELECT t.id, t.subject, t.status, t.client_id FROM support_tickets t
         WHERE t.subject LIKE '%gridpg-%' OR t.subject LIKE '%pipe-%'
            OR t.subject LIKE '%@example.test%'
         ORDER BY t.id DESC LIMIT 50`,
        [],
      ],
      [
        "affiliates test emails",
        `SELECT id, email, status FROM affiliates
         WHERE email LIKE '%@example.test' OR email LIKE '%@affiliate.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "admins @example.test",
        `SELECT id, email, role, status FROM admins
         WHERE email LIKE '%@example.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "admin_phone_numbers +1555 / Vitest",
        `SELECT id, e164, friendly_name, assigned_admin_id FROM admin_phone_numbers
         WHERE e164 LIKE '+1555%' OR friendly_name LIKE 'Vitest%'
            OR friendly_name LIKE 'AI tools OFG%'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "conversation_unknown_contacts +1555",
        `SELECT id, phone_e164, display_name, status FROM conversation_unknown_contacts
         WHERE phone_e164 LIKE '+1555%' OR email LIKE '%@example.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "admin_notify_extra_emails @example.test",
        `SELECT id, email FROM admin_notify_extra_emails
         WHERE email LIKE '%@example.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "mcp_oauth_clients vitest-",
        `SELECT id, client_id, client_name FROM mcp_oauth_clients
         WHERE client_id LIKE 'vitest-%' OR client_name LIKE '%Vitest%'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "referrers @example.test",
        `SELECT id, email, first_name, last_name FROM referrers
         WHERE email LIKE '%@example.test'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "admin_work_tasks vitest/AI tools/wt-case",
        `SELECT id, title, status FROM admin_work_tasks
         WHERE title LIKE 'AI tools task%' OR title LIKE '%wt-case-%'
            OR title LIKE '%vitest%' OR title LIKE 'fund-%'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "onboarding_task_templates optional_reopen_",
        `SELECT id, slug, title_en FROM onboarding_task_templates
         WHERE slug LIKE 'optional_reopen_%' AND COALESCE(is_system, 0) = 0
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
      [
        "client_task_completions gridpg/pipe filenames",
        `SELECT id, client_id, file_name FROM client_task_completions
         WHERE file_name LIKE '%gridpg-%' OR file_name LIKE '%pipe-%'
         ORDER BY id DESC LIMIT 50`,
        [],
      ],
    ];

    let totalHits = 0;
    for (const [label, sql] of checks) {
      try {
        const [rows] = await pool.query(sql);
        const list = rows as Array<Record<string, unknown>>;
        totalHits += list.length;
        console.log(`\n[${list.length}] ${label}`);
        for (const r of list.slice(0, 15)) {
          console.log(" ", JSON.stringify(r));
        }
        if (list.length > 15) console.log(`  … +${list.length - 15} more`);
      } catch (err) {
        console.log(`\n[ERR] ${label}: ${(err as Error).message}`);
      }
    }
    console.log(`\nTotal sample rows found: ${totalHits}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
