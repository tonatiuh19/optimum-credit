/**
 * Admin case document upload — CDN + AES path, task sync, docs_ready rules.
 * Requires DB_HOST, JWT_SECRET, CDN_UPLOAD_SECRET, DOC_ENCRYPTION_KEY.
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

const RUN_ID = `adoc-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let clientToken = "";

function tinyPng(): Buffer {
  // 1x1 PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("admin case document upload — edges + docs_ready rules", () => {
  beforeAll(async () => {
    if (
      !process.env.DB_HOST ||
      !process.env.JWT_SECRET ||
      !process.env.CDN_UPLOAD_SECRET ||
      !process.env.DOC_ENCRYPTION_KEY
    ) {
      throw new Error(
        "DB_HOST / JWT_SECRET / CDN_UPLOAD_SECRET / DOC_ENCRYPTION_KEY required",
      );
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-admin-docs",
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'AdminDoc', ?, 'en', 'onboarding', 'new_client')`,
      [CLIENT_EMAIL, RUN_ID],
    );
    clientId = ins.insertId;
    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'new_client', 'active')`,
      [clientId],
    );
    caseId = caseIns.insertId;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-T${caseId}`, caseId],
    );

    // Assign required tasks like convert/payment would
    const [tpls] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates WHERE is_active = 1 AND auto_assign = 1`,
    );
    for (const t of tpls) {
      await pool.query(
        `INSERT IGNORE INTO client_task_completions (client_id, case_id, task_template_id, status)
         VALUES (?, ?, ?, 'pending')`,
        [clientId, caseId, t.id],
      );
    }

    clientToken = await createSession(
      "client",
      clientId,
      CLIENT_EMAIL,
      "127.0.0.1",
      "vitest-admin-docs-client",
    );
  }, 90_000);

  afterAll(async () => {
    if (caseId) {
      await pool.query(`DELETE FROM client_documents WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM client_task_completions WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
    }
    if (clientId) {
      await pool.query(`DELETE FROM client_sessions WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId],
    });
    await pool?.end();
  }, 90_000);

  it("rejects invalid doc_type", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "not_a_real_type")
      .attach("files", tinyPng(), "x.png");
    expect(res.status).toBe(400);
  }, 30_000);

  it("rejects empty files", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "id_front");
    expect(res.status).toBe(400);
  }, 30_000);

  it("rejects unknown case", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/999999999/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "id_front")
      .attach("files", tinyPng(), "x.png");
    expect(res.status).toBe(404);
  }, 30_000);

  it("uploads with AES+CDN, auto-approves, syncs matching task", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "id_front")
      .attach("files", tinyPng(), "id-front.png");
    expect(res.status).toBe(201);
    expect(res.body.documents?.[0]?.review_status).toBe("approved");
    expect(res.body.documents?.[0]?.task_synced).toBe(true);
    expect(res.body.auto_advanced_docs_ready).toBe(false);

    const [docs] = await pool.query<RowDataPacket[]>(
      `SELECT review_status, encrypted, storage_provider, uploaded_by_admin_id, enc_iv, enc_tag
       FROM client_documents WHERE case_id = ? AND doc_type = 'id_front'`,
      [caseId],
    );
    expect(docs[0].review_status).toBe("approved");
    expect(Number(docs[0].encrypted)).toBe(1);
    expect(docs[0].storage_provider).toBe("cdn");
    expect(Number(docs[0].uploaded_by_admin_id)).toBe(adminId);
    expect(docs[0].enc_iv).toBeTruthy();
    expect(docs[0].enc_tag).toBeTruthy();

    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT ctc.status, ctc.admin_review_status, ctc.file_storage_key, ott.slug
       FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ? AND ott.slug = 'id_front'`,
      [caseId],
    );
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].admin_review_status).toBe("approved");
    expect(String(tasks[0].file_storage_key)).toContain("|");
  }, 60_000);

  it("appears on portal dashboard documents as approved", async () => {
    const res = await request(app)
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    const docs = res.body.documents || [];
    const found = docs.find((d: { doc_type: string }) => d.doc_type === "id_front");
    expect(found).toBeTruthy();
    expect(found.review_status).toBe("approved");
  }, 30_000);

  it("other doc_type does not sync a task", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "other")
      .attach("files", tinyPng(), "misc.png");
    expect(res.status).toBe(201);
    expect(res.body.documents?.[0]?.task_synced).toBe(false);
    expect(res.body.tasks_synced).toBe(0);
  }, 60_000);

  it("does NOT advance to docs_ready after only upload tasks (service_agreement still open)", async () => {
    for (const docType of ["id_back", "ssn_card", "proof_of_address"] as const) {
      const res = await request(app)
        .post(`/api/admin/cases/${caseId}/documents`)
        .set("Authorization", `Bearer ${adminToken}`)
        .field("doc_type", docType)
        .attach("files", tinyPng(), `${docType}.png`);
      expect(res.status).toBe(201);
      expect(res.body.auto_advanced_docs_ready).toBe(false);
    }

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("new_client");

    const [[stats]] = await pool.query<RowDataPacket[]>(
      `SELECT
         SUM(ott.is_required = 1 AND ctc.admin_review_status = 'approved') AS approved_required,
         (SELECT COUNT(*) FROM onboarding_task_templates WHERE is_active = 1 AND is_required = 1) AS required_total
       FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ?`,
      [caseId],
    );
    expect(Number(stats.approved_required)).toBeLessThan(
      Number(stats.required_total),
    );
  }, 120_000);

  it("advances to docs_ready only after ALL required tasks are approved", async () => {
    await pool.query(
      `UPDATE client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       SET ctc.status = 'completed',
           ctc.admin_review_status = 'approved',
           ctc.admin_reviewed_at = NOW(),
           ctc.signature_name = 'Test Signer',
           ctc.completed_at = NOW()
       WHERE ctc.case_id = ? AND ott.slug = 'service_agreement'`,
      [caseId],
    );

    // Trigger the same check path via a no-op re-upload of an already-approved doc
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "id_front")
      .attach("files", tinyPng(), "id-front-2.png");
    expect(res.status).toBe(201);
    expect(res.body.auto_advanced_docs_ready).toBe(true);

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("docs_ready");
  }, 60_000);

  it("reopens an approved task without notifying, rolls docs_ready back to new_client", async () => {
    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT ctc.id FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ? AND ott.slug = 'id_front' LIMIT 1`,
      [caseId],
    );
    expect(tasks[0]?.id).toBeTruthy();
    const completionId = Number(tasks[0].id);

    const res = await request(app)
      .post(`/api/admin/task-completions/${completionId}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false, reason: "Need clearer scan" });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.notified).toBe(false);
    expect(res.body.stage_rolled_back).toBe(true);
    expect(res.body.task_slug).toBe("id_front");

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT status, admin_review_status, file_storage_key, admin_notes
       FROM client_task_completions WHERE id = ?`,
      [completionId],
    );
    expect(after[0].status).toBe("pending");
    expect(after[0].admin_review_status).toBe("pending");
    expect(after[0].file_storage_key).toBeNull();
    expect(String(after[0].admin_notes)).toContain("Reopened");

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("new_client");
  }, 60_000);

  it("rejects reopen when task is not approved", async () => {
    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT ctc.id FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ? AND ott.slug = 'id_front' LIMIT 1`,
      [caseId],
    );
    const res = await request(app)
      .post(`/api/admin/task-completions/${tasks[0].id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: true });
    expect(res.status).toBe(422);
  }, 30_000);
});
