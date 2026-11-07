/**
 * One-shot repair for stuck enrollment / empty Docs Verified cases.
 *
 * Usage:
 *   npx tsx scripts/repair-stuck-enrollment.ts           # Joseph + a client + Bonner
 *   npx tsx scripts/repair-stuck-enrollment.ts --batch   # also all docs_ready with 0 required tasks
 *
 * Safe to re-run: converts only when no enrolled case; batch only when 0 required task rows.
 */
import "dotenv/config";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const batch = process.argv.includes("--batch");
  const pool = mysql.createPool({
    host: requireEnv("DB_HOST"),
    port: Number(requireEnv("DB_PORT")),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    database: requireEnv("DB_NAME"),
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
  });

  const note = `[ops repair ${new Date().toISOString().slice(0, 10)}] Enrolled after stuck prospect/active-without-case`;

  async function convertIfNeeded(
    clientId: number,
    label: string,
    packageId: number | null = 1,
  ) {
    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT id, first_name, last_name, status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    if (!clients[0]) {
      console.log(`⏭  ${label} (${clientId}): not found`);
      return;
    }
    const [enrolled] = await pool.query<RowDataPacket[]>(
      `SELECT id, case_number, pipeline_stage FROM credit_repair_cases
       WHERE client_id = ? AND status = 'active' AND pipeline_stage <> 'prospect'
       LIMIT 1`,
      [clientId],
    );
    if (enrolled[0]) {
      console.log(
        `⏭  ${label}: already enrolled ${enrolled[0].case_number} @ ${enrolled[0].pipeline_stage}`,
      );
      return;
    }

    const conn = await pool.getConnection();
    let caseId = 0;
    let caseNumber = "";
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE clients
         SET status = 'onboarding', pipeline_stage = 'new_client',
             pipeline_stage_changed_at = NOW(),
             package_id = COALESCE(?, package_id),
             admin_notes = CONCAT(COALESCE(admin_notes, ''),
               CASE WHEN admin_notes IS NULL OR admin_notes = '' THEN '' ELSE '\n' END, ?)
         WHERE id = ?`,
        [packageId, note, clientId],
      );

      const [prospectCases] = await conn.query<RowDataPacket[]>(
        `SELECT id, case_number FROM credit_repair_cases
         WHERE client_id = ? AND status = 'active' AND pipeline_stage = 'prospect'
         ORDER BY id DESC LIMIT 1`,
        [clientId],
      );
      if (prospectCases[0]) {
        caseId = Number(prospectCases[0].id);
        caseNumber =
          String(prospectCases[0].case_number || "") ||
          `CR-${String(caseId).padStart(5, "0")}`;
        await conn.query(
          `UPDATE credit_repair_cases
           SET pipeline_stage = 'new_client', pipeline_stage_changed_at = NOW(),
               package_id = COALESCE(?, package_id),
               case_number = COALESCE(case_number, ?)
           WHERE id = ?`,
          [packageId, caseNumber, caseId],
        );
      } else {
        const [ins] = await conn.query<ResultSetHeader>(
          `INSERT INTO credit_repair_cases (client_id, package_id, pipeline_stage, status, notes)
           VALUES (?, ?, 'new_client', 'active', ?)`,
          [clientId, packageId, note],
        );
        caseId = Number(ins.insertId);
        caseNumber = `CR-${String(caseId).padStart(5, "0")}`;
        await conn.query(
          `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
          [caseNumber, caseId],
        );
      }
      await conn.query(
        `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes)
         VALUES (?, 'prospect', 'new_client', NULL, ?)`,
        [clientId, note],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const [templates] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates
       WHERE is_active = 1 AND auto_assign = 1 ORDER BY sort_order ASC, id ASC`,
    );
    if (templates.length) {
      const values = templates.map(() => "(?, ?, ?, 'pending')").join(", ");
      const params = templates.flatMap((t) => [clientId, caseId, t.id]);
      await pool.query(
        `INSERT IGNORE INTO client_task_completions (client_id, case_id, task_template_id, status)
         VALUES ${values}`,
        params,
      );
    }
    console.log(
      `✅ ${label}: → onboarding/new_client ${caseNumber} (case ${caseId}), ${templates.length} tasks`,
    );
  }

  async function repairEmptyDocsReady(caseId: number, label: string) {
    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT cr.id, cr.case_number, cr.client_id, cr.pipeline_stage, c.first_name, c.last_name
       FROM credit_repair_cases cr JOIN clients c ON c.id = cr.client_id
       WHERE cr.id = ? LIMIT 1`,
      [caseId],
    );
    if (!cases[0] || String(cases[0].pipeline_stage) !== "docs_ready") {
      console.log(`⏭  ${label}: not docs_ready`);
      return;
    }
    const clientId = Number(cases[0].client_id);
    const [[cnt]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ? AND ott.is_required = 1 AND ott.is_active = 1`,
      [caseId],
    );
    if (Number(cnt.n) > 0) {
      console.log(`⏭  ${label}: already has ${cnt.n} required task rows`);
      return;
    }

    const [templates] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates
       WHERE is_active = 1 AND auto_assign = 1 ORDER BY sort_order ASC, id ASC`,
    );
    if (templates.length) {
      const values = templates.map(() => "(?, ?, ?, 'pending')").join(", ");
      const params = templates.flatMap((t) => [clientId, caseId, t.id]);
      await pool.query(
        `INSERT IGNORE INTO client_task_completions (client_id, case_id, task_template_id, status)
         VALUES ${values}`,
        params,
      );
    }
    await pool.query(
      `UPDATE credit_repair_cases
       SET pipeline_stage = 'new_client', pipeline_stage_changed_at = NOW()
       WHERE id = ?`,
      [caseId],
    );
    await pool.query(
      `UPDATE clients SET pipeline_stage = 'new_client', pipeline_stage_changed_at = NOW(),
         status = IF(status = 'active', 'onboarding', status)
       WHERE id = ?`,
      [clientId],
    );
    await pool.query(
      `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes)
       VALUES (?, 'docs_ready', 'new_client', NULL, ?)`,
      [
        clientId,
        `[ops repair] docs_ready had 0 required tasks — rolled back + assigned ${templates.length} tasks`,
      ],
    );
    console.log(
      `✅ ${label} ${cases[0].case_number}: docs_ready → new_client + ${templates.length} tasks`,
    );
  }

  try {
    console.log("\n🔧 Repair stuck enrollment…\n");
    await convertIfNeeded(11605120, "Joseph Wills");
    await convertIfNeeded(12778056, "Carlos Rodriguez");
    await repairEmptyDocsReady(7187367, "Sammonte Bonner");

    if (batch) {
      console.log("\n🔧 Batch: docs_ready with 0 required tasks…\n");
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id FROM credit_repair_cases cr
         WHERE cr.status = 'active' AND cr.pipeline_stage = 'docs_ready'
           AND NOT EXISTS (
             SELECT 1 FROM client_task_completions ctc
             JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
             WHERE ctc.case_id = cr.id AND ott.is_required = 1 AND ott.is_active = 1
           )
         ORDER BY cr.id ASC`,
      );
      console.log(`Found ${rows.length} cases`);
      for (const r of rows) {
        await repairEmptyDocsReady(Number(r.id), `case ${r.id}`);
      }
    } else {
      console.log(
        "\n(Tip: re-run with --batch to repair all docs_ready cases with 0 required tasks)\n",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
