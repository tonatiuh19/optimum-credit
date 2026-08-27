/**
 * Team-admin email alerts — purchase, installment, ready-for-review,
 * portal docs, info-request submit, re-submit dedupe.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  buildInfoRequestPresetFields,
  defaultInfoRequestTitles,
} from "../shared/infoRequestPresets";
import {
  createServer,
  createSession,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `team-alert-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let clientToken = "";
let teamAdminEmails: string[] = [];
let requiredTemplates: { id: number; slug: string; task_type: string }[] = [];

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

function purchaseSubjects(mails: ReturnType<typeof __testGetEmailDryRuns>) {
  return mails.filter(
    (e) =>
      e.subject.startsWith("New purchase —") ||
      e.subject.startsWith("Nueva compra —"),
  );
}

function paymentReceivedSubjects(
  mails: ReturnType<typeof __testGetEmailDryRuns>,
) {
  return mails.filter(
    (e) =>
      e.subject.startsWith("Payment received —") ||
      e.subject.startsWith("Pago recibido —"),
  );
}

function readySubjects(mails: ReturnType<typeof __testGetEmailDryRuns>) {
  return mails.filter(
    (e) =>
      e.subject.startsWith("Ready for review —") ||
      e.subject.startsWith("Listo para revisión —"),
  );
}

function submissionSubjects(mails: ReturnType<typeof __testGetEmailDryRuns>) {
  return mails.filter(
    (e) =>
      e.subject.startsWith("Client submission —") ||
      e.subject.startsWith("Envío del cliente —"),
  );
}

function expectAllTeamAdminsGot(
  mails: ReturnType<typeof __testGetEmailDryRuns>,
) {
  const recipients = new Set(
    mails.map((e) => String(e.to || "").trim().toLowerCase()),
  );
  const missing = teamAdminEmails.filter(
    (email) => !recipients.has(String(email).trim().toLowerCase()),
  );
  if (missing.length) {
    throw new Error(
      `missing alert emails for: ${missing.join(", ")}; got: ${[...recipients].join(", ")}`,
    );
  }
}

/** Shared TiDB — other suites may mute events; force defaults so email fans out. */
async function resetTeamAdminNotifyPrefs() {
  await pool.query(
    `UPDATE admins SET notification_prefs_json = NULL
     WHERE status = 'active'
       AND role IN ('super_admin','admin','agent')
       AND email IS NOT NULL AND TRIM(email) <> ''
       AND email NOT LIKE '%@example.test'`,
  );
  const [admins] = await pool.query<RowDataPacket[]>(
    `SELECT email FROM admins
     WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       AND email IS NOT NULL AND TRIM(email) <> ''
       AND email NOT LIKE '%@example.test'
     ORDER BY id ASC`,
  );
  teamAdminEmails = admins.map((a) => String(a.email));
}

describe("team admin notify — gaps + edges", () => {
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
         AND email IS NOT NULL AND TRIM(email) <> ''
         AND email NOT LIKE '%@example.test'
       ORDER BY id ASC`,
    );
    if (!admins[0]) throw new Error("No team admin for tests");
    adminId = Number(admins[0].id);
    teamAdminEmails = admins.map((a) => String(a.email));
    await resetTeamAdminNotifyPrefs();
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-team-alert",
    );

    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Team', 'Alert', '+15555550999', 'en', 'onboarding', 'new_client')`,
      [CLIENT_EMAIL],
    );
    clientId = clientIns.insertId;

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'new_client', 'active', ?)`,
      [clientId, RUN_ID],
    );
    caseId = caseIns.insertId;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-T${String(caseId).padStart(5, "0")}`, caseId],
    );

    clientToken = await createSession(
      "client",
      clientId,
      CLIENT_EMAIL,
      "127.0.0.1",
      "vitest-team-alert",
    );

    const [tpls] = await pool.query<RowDataPacket[]>(
      `SELECT id, slug, task_type FROM onboarding_task_templates
       WHERE is_active = 1 AND is_required = 1 ORDER BY sort_order ASC`,
    );
    requiredTemplates = tpls.map((t) => ({
      id: Number(t.id),
      slug: String(t.slug),
      task_type: String(t.task_type),
    }));
    expect(requiredTemplates.length).toBeGreaterThan(1);
  }, 60_000);

  afterAll(async () => {
    if (clientId) {
      await pool.query(
        `DELETE FROM payment_split_tokens WHERE split_id IN
          (SELECT id FROM payment_splits WHERE client_id = ?)`,
        [clientId],
      );
      await pool.query(`DELETE FROM payment_splits WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM payments WHERE client_id = ?`, [clientId]);
      await pool.query(
        `DELETE FROM client_info_request_files WHERE request_id IN
          (SELECT id FROM client_info_requests WHERE client_id = ?)`,
        [clientId],
      );
      await pool.query(`DELETE FROM client_info_requests WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(
        `DELETE FROM client_task_completions WHERE client_id = ?`,
        [clientId],
      );
      await pool.query(`DELETE FROM client_documents WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [
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

  it("intermediate task complete does not email; last required does (ready for review)", async () => {
    const last = requiredTemplates[requiredTemplates.length - 1];
    const others = requiredTemplates.slice(0, -1);

    for (const t of others) {
      await pool.query(
        `INSERT INTO client_task_completions
           (client_id, case_id, task_template_id, status, admin_review_status, completed_at)
         VALUES (?, ?, ?, 'completed', 'pending', NOW())
         ON DUPLICATE KEY UPDATE status='completed', admin_review_status='pending', completed_at=NOW()`,
        [clientId, caseId, t.id],
      );
    }

    // Completing an already-completed intermediate must not email
    __testClearEmailDryRuns();
    const intermediate = others.find((t) => t.task_type === "sign_document") ||
      others.find((t) => t.task_type === "upload");
    if (intermediate?.task_type === "sign_document") {
      await request(app)
        .post(`/api/portal/tasks/${intermediate.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .field("signature_name", "Team Alert")
        .expect(200);
    } else if (intermediate?.task_type === "upload") {
      await request(app)
        .post(`/api/portal/tasks/${intermediate.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .attach("file", tinyPng(), "mid.png")
        .expect(200);
    }
    expect(readySubjects(__testGetEmailDryRuns()).length).toBe(0);
    expect(submissionSubjects(__testGetEmailDryRuns()).length).toBe(0);

    __testClearEmailDryRuns();
    if (last.task_type === "sign_document") {
      await request(app)
        .post(`/api/portal/tasks/${last.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .field("signature_name", "Team Alert")
        .expect(200);
    } else if (last.task_type === "upload") {
      await request(app)
        .post(`/api/portal/tasks/${last.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .attach("file", tinyPng(), "last.png")
        .expect(200);
    } else {
      throw new Error(`Unexpected last task type ${last.task_type}`);
    }

    const ready = readySubjects(__testGetEmailDryRuns());
    expect(ready.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(ready);

    // Re-submit last required — still all done → no second ready alert
    __testClearEmailDryRuns();
    if (last.task_type === "sign_document") {
      await request(app)
        .post(`/api/portal/tasks/${last.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .field("signature_name", "Team Alert Again")
        .expect(200);
    } else {
      await request(app)
        .post(`/api/portal/tasks/${last.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .attach("file", tinyPng(), "last-2.png")
        .expect(200);
    }
    expect(readySubjects(__testGetEmailDryRuns()).length).toBe(0);
  }, 90_000);

  it("reopen one required then re-complete re-alerts ready for review", async () => {
    // Prefer sign_document so this assertion does not depend on CDN (upload
    // tasks flake 500 under parallel suites). Fall back to first required.
    const target =
      requiredTemplates.find((t) => t.task_type === "sign_document") ||
      requiredTemplates[0];

    // Self-contained baseline: every other required task completed; target pending.
    // (Vitest -t / order changes must not leave this relying on a prior test.)
    for (const t of requiredTemplates) {
      if (t.id === target.id) {
        await pool.query(
          `INSERT INTO client_task_completions
             (client_id, case_id, task_template_id, status, admin_review_status,
              completed_at, file_storage_key, file_name)
           VALUES (?, ?, ?, 'pending', 'pending', NULL, NULL, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'pending',
             admin_review_status = 'pending',
             completed_at = NULL,
             file_storage_key = NULL,
             file_name = NULL,
             signature_name = NULL`,
          [clientId, caseId, t.id],
        );
      } else {
        await pool.query(
          `INSERT INTO client_task_completions
             (client_id, case_id, task_template_id, status, admin_review_status, completed_at)
           VALUES (?, ?, ?, 'completed', 'pending', NOW())
           ON DUPLICATE KEY UPDATE
             status = 'completed',
             admin_review_status = 'pending',
             completed_at = NOW()`,
          [clientId, caseId, t.id],
        );
      }
    }

    __testClearEmailDryRuns();
    if (target.task_type === "upload") {
      const res = await request(app)
        .post(`/api/portal/tasks/${target.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .attach("file", tinyPng(), "reopen.png");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } else if (target.task_type === "sign_document") {
      await request(app)
        .post(`/api/portal/tasks/${target.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .field("signature_name", "Reopen Signer")
        .expect(200);
    } else if (target.task_type === "form") {
      await request(app)
        .post(`/api/portal/tasks/${target.id}/complete`)
        .set("Authorization", `Bearer ${clientToken}`)
        .field("form_data", JSON.stringify({ note: "reopen" }))
        .expect(200);
    } else {
      throw new Error(`Unsupported task_type for reopen: ${target.task_type}`);
    }
    const ready = readySubjects(__testGetEmailDryRuns());
    expect(ready.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(ready);
  }, 60_000);

  it("portal document upload emails team admins", async () => {
    __testClearEmailDryRuns();
    await request(app)
      .post("/api/portal/documents")
      .set("Authorization", `Bearer ${clientToken}`)
      .field("doc_type", "other")
      .attach("files", tinyPng(), "extra.png")
      .expect(200);

    const subs = submissionSubjects(__testGetEmailDryRuns());
    expect(subs.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(subs);
  }, 60_000);

  it("info-request submit emails team admins", async () => {
    const titles = defaultInfoRequestTitles("custom");
    const fields = buildInfoRequestPresetFields("custom");
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_info_requests
         (case_id, client_id, created_by_admin_id, preset_key,
          title_en, title_es, fields_json, status)
       VALUES (?, ?, ?, 'custom', ?, ?, ?, 'open')`,
      [
        caseId,
        clientId,
        adminId,
        titles.title_en,
        titles.title_es,
        JSON.stringify(fields),
      ],
    );
    const requestId = ins.insertId;

    __testClearEmailDryRuns();
    await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({ notes: "Team alert info request body." }),
      )
      .expect(200);

    const subs = submissionSubjects(__testGetEmailDryRuns());
    expect(subs.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(subs);
  }, 60_000);

  it("manual installment mark-paid emails Payment received", async () => {
    await resetTeamAdminNotifyPrefs();
    const due = new Date();
    due.setDate(due.getDate() + 10);
    const dueStr = due.toISOString().slice(0, 10);

    const created = await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Team alert installment",
        amount_cents: 15000,
        due_date: dueStr,
        send_payment_link: false,
      })
      .expect(201);
    const splitId = Number(created.body.split.id);

    __testClearEmailDryRuns();
    await request(app)
      .put(`/api/admin/cases/${caseId}/splits/${splitId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "paid", completion_source: "manual" })
      .expect(200);

    const paid = paymentReceivedSubjects(__testGetEmailDryRuns());
    expect(paid.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(paid);
    expect(purchaseSubjects(__testGetEmailDryRuns()).length).toBe(0);
  }, 120_000);

  it("creating an already-paid split emails Payment received", async () => {
    await resetTeamAdminNotifyPrefs();
    const due = new Date();
    due.setDate(due.getDate() + 12);
    const dueStr = due.toISOString().slice(0, 10);

    __testClearEmailDryRuns();
    await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Already paid at create",
        amount_cents: 9900,
        due_date: dueStr,
        mark_as_paid: true,
        send_payment_link: false,
      })
      .expect(201);

    const paid = paymentReceivedSubjects(__testGetEmailDryRuns());
    expect(paid.length).toBeGreaterThan(0);
    expectAllTeamAdminsGot(paid);
  }, 120_000);
});
