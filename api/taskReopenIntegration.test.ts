/**
 * Task reopen — edge scenarios: notify toggle, stage rollback, admin re-upload,
 * inactive cases, optional tasks, mid-pipeline stages, auth.
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

const RUN_ID = `reopen-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let optionalTemplateId = 0;
let optionalCompletionId = 0;

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function completionIdForSlug(slug: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ctc.id FROM client_task_completions ctc
     JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
     WHERE ctc.case_id = ? AND ott.slug = ? LIMIT 1`,
    [caseId, slug],
  );
  expect(rows[0]?.id).toBeTruthy();
  return Number(rows[0].id);
}

async function approveAllRequiredTasks() {
  await pool.query(
    `UPDATE client_task_completions ctc
     JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
     SET ctc.status = 'completed',
         ctc.admin_review_status = 'approved',
         ctc.admin_reviewed_at = NOW(),
         ctc.completed_at = NOW(),
         ctc.signature_name = IF(ott.task_type = 'sign_document', 'Edge Signer', ctc.signature_name),
         ctc.file_name = IF(ott.task_type = 'upload', CONCAT(ott.slug, '.png'), ctc.file_name),
         ctc.file_storage_key = IF(ott.task_type = 'upload', CONCAT('test|', ott.slug), ctc.file_storage_key),
         ctc.file_mime = IF(ott.task_type = 'upload', 'image/png', ctc.file_mime)
     WHERE ctc.case_id = ? AND ott.is_required = 1 AND ott.is_active = 1`,
    [caseId],
  );
}

async function setStages(stage: string) {
  await pool.query(
    `UPDATE credit_repair_cases SET pipeline_stage = ? WHERE id = ?`,
    [stage, caseId],
  );
  await pool.query(`UPDATE clients SET pipeline_stage = ? WHERE id = ?`, [
    stage,
    clientId,
  ]);
}

describe("task reopen — edge scenarios", () => {
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
      "vitest-task-reopen",
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'Reopen', ?, 'en', 'onboarding', 'new_client')`,
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
      [`CR-R${caseId}`, caseId],
    );

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

    // Optional upload template for "no stage rollback" edge
    const [optIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO onboarding_task_templates
         (slug, task_type, title_en, title_es, is_required, is_system, sort_order, is_active, auto_assign)
       VALUES (?, 'upload', 'Optional Extra', 'Extra Opcional', 0, 0, 999, 1, 0)`,
      [`optional_reopen_${RUN_ID}`],
    );
    optionalTemplateId = optIns.insertId;
    const [optC] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_task_completions
         (client_id, case_id, task_template_id, status, admin_review_status, completed_at,
          file_name, file_storage_key, file_mime)
       VALUES (?, ?, ?, 'completed', 'approved', NOW(), 'opt.png', 'test|opt', 'image/png')`,
      [clientId, caseId, optionalTemplateId],
    );
    optionalCompletionId = optC.insertId;
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
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
    }
    if (optionalTemplateId) {
      await pool.query(`DELETE FROM onboarding_task_templates WHERE id = ?`, [
        optionalTemplateId,
      ]);
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
  });

  it("rejects unauthenticated reopen", async () => {
    const id = await completionIdForSlug("id_front");
    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .send({ notify_client: false });
    expect(res.status).toBe(401);
  }, 30_000);

  it("rejects invalid completion id", async () => {
    const res = await request(app)
      .post(`/api/admin/task-completions/not-a-number/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(400);
  }, 30_000);

  it("rejects unknown completion id", async () => {
    const res = await request(app)
      .post(`/api/admin/task-completions/999999999/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(404);
  }, 30_000);

  it("rejects reopen when task is still pending", async () => {
    const id = await completionIdForSlug("id_front");
    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/approved/i);
  }, 30_000);

  it("does not roll back stage when reopening on new_client", async () => {
    await approveAllRequiredTasks();
    await setStages("new_client");
    const id = await completionIdForSlug("id_back");

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false, reason: "Blurry back" });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.stage_rolled_back).toBe(false);
    expect(res.body.pipeline_stage).toBe("new_client");
    expect(res.body.notified).toBe(false);
    expect(res.body.notify_requested).toBe(false);

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT status, admin_review_status, file_storage_key, admin_notes
       FROM client_task_completions WHERE id = ?`,
      [id],
    );
    expect(after[0].status).toBe("pending");
    expect(after[0].admin_review_status).toBe("pending");
    expect(after[0].file_storage_key).toBeNull();
    expect(String(after[0].admin_notes)).toContain("Blurry back");

    // Re-approve for later tests
    await pool.query(
      `UPDATE client_task_completions
       SET status = 'completed', admin_review_status = 'approved',
           completed_at = NOW(), file_name = 'id_back.png',
           file_storage_key = 'test|id_back', file_mime = 'image/png'
       WHERE id = ?`,
      [id],
    );
  }, 60_000);

  it("rolls docs_ready → new_client for required task (case + client + history)", async () => {
    await approveAllRequiredTasks();
    await setStages("docs_ready");
    const id = await completionIdForSlug("ssn_card");

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(200);
    expect(res.body.stage_rolled_back).toBe(true);
    expect(res.body.pipeline_stage).toBe("new_client");
    expect(res.body.is_required).toBe(true);

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(cases[0].pipeline_stage).toBe("new_client");
    expect(clients[0].pipeline_stage).toBe("new_client");

    const [hist] = await pool.query<RowDataPacket[]>(
      `SELECT from_stage, to_stage, notes FROM client_pipeline_history
       WHERE client_id = ? ORDER BY id DESC LIMIT 1`,
      [clientId],
    );
    expect(hist[0].from_stage).toBe("docs_ready");
    expect(hist[0].to_stage).toBe("new_client");
    expect(String(hist[0].notes)).toContain("ssn_card");
  }, 60_000);

  it("notifies client + creates onboarding token when notify_client=true", async () => {
    // Ensure task approved again
    const id = await completionIdForSlug("ssn_card");
    await pool.query(
      `UPDATE client_task_completions
       SET status = 'completed', admin_review_status = 'approved',
           completed_at = NOW(), file_name = 'ssn.png',
           file_storage_key = 'test|ssn', file_mime = 'image/png'
       WHERE id = ?`,
      [id],
    );
    await setStages("new_client");

    const [[before]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: true, reason: "Please resubmit SSN" });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.notify_requested).toBe(true);
    expect(res.body.notified).toBe(true);
    expect(res.body.emailed).toBe(CLIENT_EMAIL);
    expect(res.body.expires_at).toBeTruthy();
    expect(res.body.notify_error).toBeNull();
    expect(res.body.stage_rolled_back).toBe(false);

    const [[after]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    expect(Number(after.n)).toBe(Number(before.n) + 1);
  }, 60_000);

  it("optional approved task on docs_ready does NOT roll back stage", async () => {
    await approveAllRequiredTasks();
    await setStages("docs_ready");

    const res = await request(app)
      .post(`/api/admin/task-completions/${optionalCompletionId}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.is_required).toBe(false);
    expect(res.body.stage_rolled_back).toBe(false);
    expect(res.body.pipeline_stage).toBe("docs_ready");

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("docs_ready");
  }, 60_000);

  it("rolls back round_1 → new_client when required task reopened", async () => {
    await approveAllRequiredTasks();
    await setStages("round_1");
    const id = await completionIdForSlug("proof_of_address");

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(200);
    expect(res.body.stage_rolled_back).toBe(true);
    expect(res.body.pipeline_stage).toBe("new_client");

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("new_client");

    // Restore for next tests
    await pool.query(
      `UPDATE client_task_completions
       SET status = 'completed', admin_review_status = 'approved',
           completed_at = NOW(), file_name = 'poa.png',
           file_storage_key = 'test|poa', file_mime = 'image/png'
       WHERE id = ?`,
      [id],
    );
    await setStages("new_client");
  }, 60_000);

  it("notify with empty email skips send (notify_skipped_reason=no_email)", async () => {
    await approveAllRequiredTasks();
    await setStages("new_client");
    const id = await completionIdForSlug("id_front");
    const [[before]] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM clients WHERE id = ?`,
      [clientId],
    );
    const originalEmail = String(before.email);
    await pool.query(`UPDATE clients SET email = '' WHERE id = ?`, [clientId]);

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: true });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.notified).toBe(false);
    expect(res.body.notify_requested).toBe(true);
    expect(res.body.notify_skipped_reason).toBe("no_email");

    await pool.query(`UPDATE clients SET email = ? WHERE id = ?`, [
      originalEmail,
      clientId,
    ]);
    await pool.query(
      `UPDATE client_task_completions
       SET status = 'completed', admin_review_status = 'approved',
           completed_at = NOW()
       WHERE id = ?`,
      [id],
    );
  }, 60_000);

  it("email failure still reopens (notify_error set)", async () => {
    await approveAllRequiredTasks();
    await setStages("new_client");
    const id = await completionIdForSlug("id_back");
    process.env.VITEST_REOPEN_EMAIL_FAIL = "1";
    try {
      const res = await request(app)
        .post(`/api/admin/task-completions/${id}/reopen`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ notify_client: true });
      expect(res.status).toBe(200);
      expect(res.body.reopened).toBe(true);
      expect(res.body.notified).toBe(false);
      expect(res.body.notify_error).toBe("forced_email_fail");
    } finally {
      delete process.env.VITEST_REOPEN_EMAIL_FAIL;
    }
  }, 60_000);

  it("rejects reopen on cancelled case", async () => {
    await approveAllRequiredTasks();
    await pool.query(
      `UPDATE credit_repair_cases SET status = 'cancelled' WHERE id = ?`,
      [caseId],
    );
    const id = await completionIdForSlug("id_front");
    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/non-active/i);

    await pool.query(
      `UPDATE credit_repair_cases SET status = 'active' WHERE id = ?`,
      [caseId],
    );
  }, 60_000);

  it("clears service_agreement signature on reopen + rolls docs_ready back", async () => {
    await approveAllRequiredTasks();
    await setStages("docs_ready");
    const id = await completionIdForSlug("service_agreement");

    const [before] = await pool.query<RowDataPacket[]>(
      `SELECT signature_name, status, admin_review_status
       FROM client_task_completions WHERE id = ?`,
      [id],
    );
    expect(before[0].signature_name).toBeTruthy();
    expect(before[0].admin_review_status).toBe("approved");

    const res = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(res.status).toBe(200);
    expect(res.body.stage_rolled_back).toBe(true);
    expect(res.body.task_type).toBe("sign_document");

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT signature_name, signature_ip, status, admin_review_status
       FROM client_task_completions WHERE id = ?`,
      [id],
    );
    expect(after[0].signature_name).toBeNull();
    expect(after[0].signature_ip).toBeNull();
    expect(after[0].status).toBe("pending");
    expect(after[0].admin_review_status).toBe("pending");
  }, 60_000);

  it("admin upload after reopen re-approves task and can re-advance to docs_ready", async () => {
    // Restore SA + all required approved except id_front (reopen it)
    await approveAllRequiredTasks();
    await setStages("docs_ready");
    const idFront = await completionIdForSlug("id_front");

    const reopen = await request(app)
      .post(`/api/admin/task-completions/${idFront}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(reopen.status).toBe(200);
    expect(reopen.body.stage_rolled_back).toBe(true);

    const upload = await request(app)
      .post(`/api/admin/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("doc_type", "id_front")
      .attach("files", tinyPng(), "id-front-reopen.png");
    expect(upload.status).toBe(201);
    expect(upload.body.documents?.[0]?.task_synced).toBe(true);
    expect(upload.body.auto_advanced_docs_ready).toBe(true);

    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT status, admin_review_status, file_name
       FROM client_task_completions WHERE id = ?`,
      [idFront],
    );
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].admin_review_status).toBe("approved");
    expect(String(tasks[0].file_name)).toContain("id-front-reopen");

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ?`,
      [caseId],
    );
    expect(cases[0].pipeline_stage).toBe("docs_ready");
  }, 90_000);

  it("double-reopen races to 422/409 on second call", async () => {
    await approveAllRequiredTasks();
    await setStages("new_client");
    const id = await completionIdForSlug("id_back");

    const first = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/admin/task-completions/${id}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_client: false });
    expect([422, 409]).toContain(second.status);
  }, 60_000);
});
