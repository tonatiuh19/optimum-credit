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
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `pipe-${Date.now()}`;
const EMAIL_EN = `${RUN_ID}-en@example.test`;
const EMAIL_ES = `${RUN_ID}-es@example.test`;
const EMAIL_PROSPECT = `${RUN_ID}-prospect@example.test`;
const EMAIL_WILDCARD = `${RUN_ID}-pct%wild@example.test`;
const EMAIL_GHOST = `${RUN_ID}-ghost@example.test`;
const EMAIL_CHECKOUT = `${RUN_ID}-checkout@example.test`;
const GHOST_PHONE = `(951) 648-${String(Date.now()).slice(-4)}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientEnId = 0;
let clientEsId = 0;
let prospectId = 0;
let wildcardClientId = 0;
let ghostLeadId = 0;
let checkoutLeadId = 0;
let caseEnId = 0;
let caseEsId = 0;
let caseWildcardId = 0;
let packageId = 0;
let labelSlug = "";
let labelId = 0;

describe("admin pipeline filters", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
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

    const [ghost] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'PipeGhost', ?, ?, 'en', 'pending_payment', 'prospect')`,
      [EMAIL_GHOST, RUN_ID, GHOST_PHONE],
    );
    ghostLeadId = ghost.insertId;

    const [checkout] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'PipeCheckout', ?, 'en', 'pending_payment', 'new_client')`,
      [EMAIL_CHECKOUT, RUN_ID],
    );
    checkoutLeadId = checkout.insertId;

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
    for (const id of [
      clientEnId,
      clientEsId,
      prospectId,
      wildcardClientId,
      ghostLeadId,
      checkoutLeadId,
    ]) {
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
      clientIds: [
        clientEnId,
        clientEsId,
        prospectId,
        wildcardClientId,
        ghostLeadId,
        checkoutLeadId,
      ],
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

  it("includes pending_payment + prospect-stage leads (no case) on Prospect", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "prospect", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const pids = (res.body.prospects || []).map((p: { id: number }) => p.id);
    expect(pids).toContain(ghostLeadId);
    expect(pids).not.toContain(checkoutLeadId);
    const caseIds = (res.body.cases || []).map((c: { id: number }) => c.id);
    expect(caseIds).toEqual([]);
  }, 30_000);

  it("does not put pending_payment checkout (new_client, no case) on New Client", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "new_client", search: RUN_ID })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const pids = (res.body.prospects || []).map((p: { id: number }) => p.id);
    expect(pids).not.toContain(ghostLeadId);
    expect(pids).not.toContain(checkoutLeadId);
    const clientIds = (res.body.cases || []).map(
      (c: { client_id: number }) => c.client_id,
    );
    expect(clientIds).not.toContain(ghostLeadId);
    expect(clientIds).not.toContain(checkoutLeadId);
  }, 30_000);

  it("searches prospects by client id and digit-stripped phone", async () => {
    const byId = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "prospect", search: String(ghostLeadId) })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byId.status).toBe(200);
    const idHits = (byId.body.prospects || []).map((p: { id: number }) => p.id);
    expect(idHits).toContain(ghostLeadId);

    const digits = GHOST_PHONE.replace(/\D/g, "");
    const byPhone = await request(app)
      .get("/api/admin/pipeline")
      .query({ stage: "prospect", search: digits })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byPhone.status).toBe(200);
    const phoneHits = (byPhone.body.prospects || []).map(
      (p: { id: number }) => p.id,
    );
    expect(phoneHits).toContain(ghostLeadId);
  }, 30_000);

  it("lists clients by numeric id and digit-stripped phone", async () => {
    const byId = await request(app)
      .get("/api/admin/clients")
      .query({ search: String(ghostLeadId) })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byId.status).toBe(200);
    const idHits = (byId.body.clients || []).map((c: { id: number }) => c.id);
    expect(idHits).toContain(ghostLeadId);

    const digits = GHOST_PHONE.replace(/\D/g, "");
    const byPhone = await request(app)
      .get("/api/admin/clients")
      .query({ search: digits })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byPhone.status).toBe(200);
    const phoneHits = (byPhone.body.clients || []).map(
      (c: { id: number }) => c.id,
    );
    expect(phoneHits).toContain(ghostLeadId);
  }, 30_000);

  it("GET /admin/clients unconverted_lead includes pending_payment prospect-stage", async () => {
    const res = await request(app)
      .get("/api/admin/clients")
      .query({ search: RUN_ID, unconverted_lead: "1" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.clients || []).map((c: { id: number }) => c.id);
    expect(ids).toContain(ghostLeadId);
    expect(ids).toContain(prospectId);
    expect(ids).not.toContain(checkoutLeadId);
    expect(ids).not.toContain(clientEnId);
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

  it("paginates columns on board and load-more", async () => {
    const board = await request(app)
      .get("/api/admin/pipeline")
      .query({ search: RUN_ID, limit: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(board.status).toBe(200);
    expect(board.body.limit).toBe(1);
    expect(board.body.columns).toBeTruthy();
    const nc = board.body.columns.new_client;
    expect(nc.total).toBeGreaterThanOrEqual(2);
    expect(nc.items.length).toBe(1);
    expect(nc.has_more).toBe(true);
    expect(board.body.columns.prospect.total).toBeGreaterThanOrEqual(1);

    const firstId = nc.items[0].id as number;
    const more = await request(app)
      .get("/api/admin/pipeline")
      .query({
        search: RUN_ID,
        limit: 1,
        column: "new_client",
        offset: 1,
      })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(more.status).toBe(200);
    expect(more.body.column).toBe("new_client");
    expect(more.body.items.length).toBe(1);
    expect(more.body.items[0].id).not.toBe(firstId);
    expect(more.body.total).toBe(nc.total);
    expect(more.body.has_more).toBe(1 + more.body.items.length < more.body.total);
  }, 30_000);

  it("GET /admin/clients returns pagination metadata and respects limit/page", async () => {
    const res = await request(app)
      .get("/api/admin/clients")
      .query({ search: RUN_ID, limit: 2, page: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(5);
    expect(res.body.clients.length).toBeLessThanOrEqual(2);

    const p1 = await request(app)
      .get("/api/admin/clients")
      .query({
        search: RUN_ID,
        limit: 2,
        page: 1,
        sort_by: "first_name",
        sort_dir: "ASC",
      })
      .set("Authorization", `Bearer ${adminToken}`);
    const p2 = await request(app)
      .get("/api/admin/clients")
      .query({
        search: RUN_ID,
        limit: 2,
        page: 2,
        sort_by: "first_name",
        sort_dir: "ASC",
      })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    if (p1.body.pagination.total > 2) {
      expect(p1.body.clients).toHaveLength(2);
      expect(p2.body.clients.length).toBeGreaterThan(0);
      expect(p1.body.clients[0].id).not.toBe(p2.body.clients[0].id);
    } else {
      expect(p2.body.clients).toEqual([]);
    }
  }, 30_000);

  it("GET /admin/clients page beyond total returns empty slice with valid pagination", async () => {
    const res = await request(app)
      .get("/api/admin/clients")
      .query({ search: RUN_ID, limit: 50, page: 999 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([]);
    expect(res.body.pagination.page).toBe(999);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  }, 30_000);

  it("GET /admin/clients rejects unknown sort_by safely (falls back to created_at)", async () => {
    const res = await request(app)
      .get("/api/admin/clients")
      .query({ search: RUN_ID, sort_by: "DROP TABLE", limit: 5 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clients)).toBe(true);
    expect(res.body.pagination).toBeTruthy();
  }, 30_000);
});
