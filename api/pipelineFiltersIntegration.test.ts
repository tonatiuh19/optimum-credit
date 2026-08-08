/**
 * Pipeline board — server-side search / filter edges (expanded coverage).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createServer, createSession } from "./index";
import { cleanupIntegrationTestClients } from "./testDbCleanup";

const RUN_ID = `pipe-${Date.now()}`;
const EMAIL_EN = `${RUN_ID}-en@example.test`;
const EMAIL_ES = `${RUN_ID}-es@example.test`;
const EMAIL_PROSPECT = `${RUN_ID}-prospect@example.test`;
const EMAIL_WILDCARD = `${RUN_ID}-pct%wild@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientEnId = 0;
let clientEsId = 0;
let prospectId = 0;
let wildcardClientId = 0;
let caseEnId = 0;
let caseEsId = 0;
let caseWildcardId = 0;
let packageId = 0;
let labelSlug = "";
let labelId = 0;

async function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectionLimit: 3,
  });
}

describe("admin pipeline filters", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-pipeline-filters",
    );

    const [pkgs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM packages WHERE is_active = 1 ORDER BY id ASC LIMIT 1`,
    );
    packageId = pkgs[0] ? Number(pkgs[0].id) : 0;

    labelSlug = `pipe_lbl_${RUN_ID}`;
    const [lbl] = await pool.query<ResultSetHeader>(
      `INSERT INTO labels (slug, name_en, name_es, layer, color, sort_order)
       VALUES (?, 'Pipe Label', 'Etiqueta Pipe', 'analysis', 'blue', 0)`,
      [labelSlug],
    );
    labelId = lbl.insertId;

    const [en] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage,
          phone, assigned_admin_id, referral_category, admin_notes, package_id)
       VALUES (?, 'PipeEn', ?, 'en', 'onboarding', 'new_client',
               '5551112222', ?, 'realtor_broker', 'Internal note EN', ?)`,
      [EMAIL_EN, RUN_ID, adminId, packageId || null],
    );
    clientEnId = en.insertId;
    await pool.query(
      `INSERT IGNORE INTO client_labels (client_id, label_id) VALUES (?, ?)`,
      [clientEnId, labelId],
    );

    const [es] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage,
          referral_category)
       VALUES (?, 'PipeEs', ?, 'es', 'active', 'docs_ready', 'one_off')`,
      [EMAIL_ES, RUN_ID],
    );
    clientEsId = es.insertId;

    const [pr] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'PipeProspect', ?, 'en', 'prospect', 'prospect')`,
      [EMAIL_PROSPECT, RUN_ID],
    );
    prospectId = pr.insertId;

    const [wc] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'WildPct', ?, 'en', 'onboarding', 'new_client')`,
      [EMAIL_WILDCARD, RUN_ID],
    );
    wildcardClientId = wc.insertId;

    const [cEn] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, package_id)
       VALUES (?, 'new_client', 'active', ?)`,
      [clientEnId, packageId || null],
    );
    caseEnId = cEn.insertId;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-PF${caseEnId}`, caseEnId],
    );

    const [cEs] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'docs_ready', 'on_hold')`,
      [clientEsId],
    );
    caseEsId = cEs.insertId;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-PF${caseEsId}`, caseEsId],
    );

    const [cWc] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'new_client', 'active')`,
      [wildcardClientId],
    );
    caseWildcardId = cWc.insertId;

    // Seed required task completions so tasks filter can distinguish
    const [tpls] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates WHERE is_active = 1 AND is_required = 1`,
    );
    for (const t of tpls) {
      await pool.query(
        `INSERT IGNORE INTO client_task_completions
           (client_id, case_id, task_template_id, status, admin_review_status)
         VALUES (?, ?, ?, 'pending', 'pending')`,
        [clientEnId, caseEnId, t.id],
      );
      await pool.query(
        `INSERT IGNORE INTO client_task_completions
           (client_id, case_id, task_template_id, status, admin_review_status, completed_at)
         VALUES (?, ?, ?, 'completed', 'approved', NOW())`,
        [clientEsId, caseEsId, t.id],
      );
    }

    // One pending-review on EN case
    await pool.query(
      `UPDATE client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       SET ctc.status = 'completed', ctc.admin_review_status = 'pending',
           ctc.completed_at = NOW(), ctc.file_name = 'x.png'
       WHERE ctc.case_id = ? AND ott.slug = 'id_front' LIMIT 1`,
      [caseEnId],
    );

    // Overdue split on EN client for billing filter
    await pool.query(
      `INSERT INTO payment_splits
         (client_id, case_id, amount_cents, due_date, status, label)
       VALUES (?, ?, 10000, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'overdue', 'Pipe test')`,
      [clientEnId, caseEnId],
    );

    // Paid split on ES client so payment_badge=paid matches real money
    await pool.query(
      `INSERT INTO payment_splits
         (client_id, case_id, amount_cents, due_date, status, label, paid_at)
       VALUES (?, ?, 5000, CURDATE(), 'paid', 'Pipe paid', NOW())`,
      [clientEsId, caseEsId],
    );

    // Open info request on EN case
    await pool.query(
      `INSERT INTO client_info_requests
         (case_id, client_id, title_en, title_es, fields_json, status)
       VALUES (?, ?, 'Need docs', 'Necesita docs', '[]', 'open')`,
      [caseEnId, clientEnId],
    );
  }, 120_000);

  afterAll(async () => {
    for (const id of [caseEnId, caseEsId, caseWildcardId]) {
      if (!id) continue;
      await pool.query(`DELETE FROM client_info_requests WHERE case_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM client_documents WHERE case_id = ?`, [id]);
      await pool.query(`DELETE FROM client_task_completions WHERE case_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM payment_splits WHERE case_id = ?`, [id]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id]);
    }
    for (const id of [clientEnId, clientEsId, prospectId, wildcardClientId]) {
      if (!id) continue;
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM payment_splits WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM client_sessions WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    if (labelId) {
      await pool.query(`DELETE FROM labels WHERE id = ?`, [labelId]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientEnId, clientEsId, prospectId, wildcardClientId],
    });
    await pool?.end();
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/admin/pipeline");
    expect(res.status).toBe(401);
  }, 15_000);

  it("searches by case number", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ search: `CR-PF${caseEnId}` })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("treats % in search as literal (LIKE escape)", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ search: `${RUN_ID}-pct%wild` })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseWildcardId);
    // Must not match everything via unescaped %
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by language=es", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ language: "es", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);

  it("filters by stage=new_client and hides prospects", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "new_client", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
    expect(res.body.prospects || []).toEqual([]);
  }, 30_000);

  it("filters stage=prospect (cases empty, prospect present)", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "prospect", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cases || []).toEqual([]);
    const pids = (res.body.prospects || []).map((p: { id: number }) => p.id);
    expect(pids).toContain(prospectId);
  }, 30_000);

  it("filters by payment_badge using real payments/splits", async () => {
    const paid = await request(app)
      .get("/api/admin/pipeline")
      .query({ payment_badge: "paid", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(paid.status).toBe(200);
    const paidIds = (paid.body.cases || []).map((c: { id: number }) => c.id);
    expect(paidIds).toContain(caseEsId);
    expect(paidIds).not.toContain(caseEnId);

    const unpaid = await request(app)
      .get("/api/admin/pipeline")
      .query({ payment_badge: "unpaid", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unpaid.status).toBe(200);
    const unpaidIds = (unpaid.body.cases || []).map(
      (c: { id: number }) => c.id,
    );
    expect(unpaidIds).toContain(caseEnId);
    expect(unpaidIds).not.toContain(caseEsId);
  }, 30_000);

  it("filters by billing=overdue", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ billing: "overdue", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by package_id and hides prospects", async () => {
    if (!packageId) return;
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ package_id: String(packageId), search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(res.body.prospects || []).toEqual([]);
  }, 30_000);

  it("filters by package_id=none", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ package_id: "none", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);

  it("filters by assigned_admin_id", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ assigned_admin_id: String(adminId), search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by assigned_admin_id=unassigned", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ assigned_admin_id: "unassigned", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);

  it("filters by referral_category", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ referral_category: "realtor_broker", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by client_status", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ client_status: "active", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);

  it("filters by case_status=on_hold", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ case_status: "on_hold", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
    expect(res.body.prospects || []).toEqual([]);
  }, 30_000);

  it("filters by tasks=pending_review", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ tasks: "pending_review", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
  }, 30_000);

  it("filters by tasks=complete", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ tasks: "complete", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);

  it("filters by info_requests=open", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ info_requests: "open", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by has_notes=yes", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ has_notes: "yes", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("filters by labels", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ labels: labelSlug, search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEnId);
    expect(ids).not.toContain(caseEsId);
  }, 30_000);

  it("combines language + payment_badge + search", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({
        search: RUN_ID,
        language: "es",
        payment_badge: "paid",
      })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(caseEsId);
    expect(ids).not.toContain(caseEnId);
  }, 30_000);
});
