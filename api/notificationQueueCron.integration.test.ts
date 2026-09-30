/**
 * Notification queue cron — auth, stale cancel, claim-tag send path.
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
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  __testMarkPaymentSucceeded,
  __testCancelPaymentConfirmedUploadNudges,
  __testShouldSuppressPaymentConfirmedUploadNudges,
  createServer,
  resolveLanguageOwnerAdminId,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool, VITEST_CRON_SECRET } from "./testDbCleanup";

const RUN_ID = `nq-cron-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let prevCron: string | undefined;
const clientIds: number[] = [];

describe("notification queue cron", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = VITEST_CRON_SECRET;
    pool = createIntegrationTestPool();
    app = createServer();
  }, 60_000);

  afterAll(async () => {
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
    for (const id of clientIds) {
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM payments WHERE client_id = ?`, [id]);
      await pool.query(
        `DELETE FROM client_task_completions WHERE client_id = ?`,
        [id],
      );
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    await pool?.end();
  }, 60_000);

  it("rejects missing/wrong secret; accepts Bearer GET and x-cron-secret POST", async () => {
    const secret = VITEST_CRON_SECRET;
    await request(app).get("/api/cron/process-queue").expect(401);
    await request(app)
      .post("/api/cron/process-queue")
      .set("x-cron-secret", "nope")
      .expect(401);
    await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", "Bearer nope")
      .expect(401);

    const okGet = await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", `Bearer ${secret}`);
    expect(
      okGet.status,
      `process-queue GET body=${JSON.stringify(okGet.body)}`,
    ).toBe(200);
    expect(okGet.body.ok).toBe(true);

    const okPost = await request(app)
      .post("/api/cron/process-queue")
      .set("x-cron-secret", secret);
    expect(
      okPost.status,
      `process-queue POST body=${JSON.stringify(okPost.body)}`,
    ).toBe(200);
    expect(okPost.body.ok).toBe(true);
  }, 45_000);

  it("cancels stale pending email and sends due email via claim tag", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('Queue', ?, ?, 'onboarding', 'new_client', 'en')`,
      [RUN_ID, `queue-${RUN_ID}@example.test`],
    );
    const clientId = Number(ins.insertId);
    clientIds.push(clientId);

    const [staleIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status)
       VALUES (?, 'email', ?, 'STALE', '<p>old</p>', NOW() - INTERVAL 20 DAY, 'pending')`,
      [clientId, `queue-${RUN_ID}@example.test`],
    );
    const staleId = Number(staleIns.insertId);

    const [dueIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status)
       VALUES (?, 'email', ?, ?, '<p>due now</p>', NOW() - INTERVAL 1 MINUTE, 'pending')`,
      [clientId, `queue-${RUN_ID}@example.test`, `Due nudge ${RUN_ID}`],
    );
    const dueId = Number(dueIns.insertId);

    const [futureIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status)
       VALUES (?, 'email', ?, 'FUTURE', '<p>later</p>', NOW() + INTERVAL 2 DAY, 'pending')`,
      [clientId, `queue-${RUN_ID}@example.test`],
    );
    const futureId = Number(futureIns.insertId);

    __testClearEmailDryRuns();
    const res = await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.stale_cancelled).toBeGreaterThanOrEqual(1);
    // Bare emails (no payload_json) must send even when the client has no
    // active case — suppress only applies to explicit payment_confirmed.
    expect(
      Number(res.body.sent || 0),
      `expected send; body=${JSON.stringify(res.body)}`,
    ).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.suppressed || 0)).toBe(0);

    const [staleRow] = await pool.query<RowDataPacket[]>(
      `SELECT status, error_message FROM notification_queue WHERE id = ?`,
      [staleId],
    );
    expect(staleRow[0]?.status).toBe("cancelled");
    expect(String(staleRow[0]?.error_message || "")).toMatch(/stale/i);

    const [dueRow] = await pool.query<RowDataPacket[]>(
      `SELECT status, sent_at, error_message FROM notification_queue WHERE id = ?`,
      [dueId],
    );
    expect(
      dueRow[0]?.status,
      `due error=${String(dueRow[0]?.error_message || "")}`,
    ).toBe("sent");
    expect(dueRow[0]?.sent_at).toBeTruthy();

    const [futureRow] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM notification_queue WHERE id = ?`,
      [futureId],
    );
    expect(futureRow[0]?.status).toBe("pending");

    const dry = __testGetEmailDryRuns().filter((e) =>
      e.subject.includes(RUN_ID),
    );
    expect(dry.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("payment_confirmed Day-0 notifies language owner of upload link", async () => {
    const ownerId = await resolveLanguageOwnerAdminId("en");
    if (!ownerId) {
      // eslint-disable-next-line no-console
      console.warn("[skip] no language_owner_for=en admin");
      return;
    }
    const [owners] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE id = ? LIMIT 1`,
      [ownerId],
    );
    const ownerEmail = String(owners[0]?.email || "").toLowerCase();
    expect(ownerEmail).toBeTruthy();

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('PayFlow', ?, ?, 'pending_payment', 'new_client', 'en')`,
      [RUN_ID, `payflow-${RUN_ID}@example.test`],
    );
    const clientId = Number(ins.insertId);
    clientIds.push(clientId);

    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'new_client', 'active', ?)`,
      [clientId, RUN_ID],
    );
    const caseId = Number(cIns.insertId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-Q${String(caseId).padStart(5, "0")}`, caseId],
    );

    const txnId = `txn-nq-${RUN_ID}`;
    await pool.query(
      `INSERT INTO payments
         (client_id, case_id, amount_cents, status, provider, provider_transaction_id)
       VALUES (?, ?, 9900, 'pending', 'manual', ?)`,
      [clientId, caseId, txnId],
    );

    __testClearEmailDryRuns();
    await __testMarkPaymentSucceeded(clientId, txnId);
    await new Promise((r) => setTimeout(r, 5_000));

    const ownerMails = __testGetEmailDryRuns().filter(
      (e) =>
        e.to.toLowerCase() === ownerEmail &&
        (e.subject.includes("received the upload link") ||
          e.subject.includes("recibió el enlace")),
    );
    expect(ownerMails.length).toBeGreaterThanOrEqual(1);

    const [tokens] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    expect(Number(tokens[0]?.c || 0)).toBeGreaterThanOrEqual(1);
  }, 90_000);

  it("work_task_overdue cron sends branded email and stamps due_notified_at", async () => {
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, first_name, notification_prefs_json FROM admins
       WHERE status = 'active' AND email IS NOT NULL AND TRIM(email) <> ''
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("Need an active admin for overdue test");
    const assigneeId = Number(admins[0].id);
    const assigneeEmail = String(admins[0].email).toLowerCase();
    const prevPrefs = admins[0].notification_prefs_json;

    // Null prefs = all channels ON (legacy default)
    await pool.query(
      `UPDATE admins SET notification_prefs_json = NULL WHERE id = ?`,
      [assigneeId],
    );

    const [taskIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_work_tasks
         (title, status, priority, assignee_admin_id, created_by_admin_id, due_at, due_notified_at, source)
       VALUES (?, 'doing', 'high', ?, ?, UTC_TIMESTAMP() - INTERVAL 20 YEAR, NULL, 'optimum')`,
      [`Overdue brand ${RUN_ID}`, assigneeId, assigneeId],
    );
    const taskId = Number(taskIns.insertId);

    try {
      const [dueCheck] = await pool.query<RowDataPacket[]>(
        `SELECT due_at < UTC_TIMESTAMP() AS overdue, due_notified_at
         FROM admin_work_tasks WHERE id = ? LIMIT 1`,
        [taskId],
      );
      expect(Number(dueCheck[0]?.overdue || 0)).toBe(1);
      expect(dueCheck[0]?.due_notified_at).toBeFalsy();

      __testClearEmailDryRuns();
      const res = await request(app)
        .post("/api/cron/process-queue")
        .set("x-cron-secret", VITEST_CRON_SECRET)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(
        Number(res.body.work_due_notified || 0),
        JSON.stringify(res.body),
      ).toBeGreaterThanOrEqual(1);

      const mails = __testGetEmailDryRuns().filter(
        (e) =>
          e.to.toLowerCase() === assigneeEmail &&
          String(e.subject || "").includes(`Overdue brand ${RUN_ID}`),
      );
      expect(mails.length).toBeGreaterThanOrEqual(1);
      expect(mails[0].brandedChrome).toBe(true);

      const [row] = await pool.query<RowDataPacket[]>(
        `SELECT due_notified_at FROM admin_work_tasks WHERE id = ?`,
        [taskId],
      );
      expect(row[0]?.due_notified_at).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [taskId]);
      await pool.query(
        `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
        [prevPrefs ?? null, assigneeId],
      );
    }
  }, 60_000);

  it("work_task_overdue cron stamps muted-pref rows so they cannot starve the batch", async () => {
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, notification_prefs_json FROM admins
       WHERE status = 'active' AND email IS NOT NULL AND TRIM(email) <> ''
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("Need an active admin for muted overdue test");
    const assigneeId = Number(admins[0].id);
    const prevPrefs = admins[0].notification_prefs_json;
    const muted = JSON.stringify({
      email: { work_task_overdue: false },
      in_app: { work_task_overdue: false },
      sms: { work_task_overdue: false },
    });
    await pool.query(
      `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
      [muted, assigneeId],
    );

    const [taskIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_work_tasks
         (title, status, priority, assignee_admin_id, created_by_admin_id, due_at, due_notified_at, source)
       VALUES (?, 'doing', 'high', ?, ?, UTC_TIMESTAMP() - INTERVAL 21 YEAR, NULL, 'optimum')`,
      [`Overdue muted ${RUN_ID}`, assigneeId, assigneeId],
    );
    const taskId = Number(taskIns.insertId);

    try {
      const res = await request(app)
        .post("/api/cron/process-queue")
        .set("x-cron-secret", VITEST_CRON_SECRET)
        .expect(200);
      expect(res.body.ok).toBe(true);

      const [row] = await pool.query<RowDataPacket[]>(
        `SELECT due_notified_at FROM admin_work_tasks WHERE id = ?`,
        [taskId],
      );
      expect(row[0]?.due_notified_at).toBeTruthy();
    } finally {
      await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [taskId]);
      await pool.query(
        `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
        [prevPrefs ?? null, assigneeId],
      );
    }
  }, 60_000);

  it("after reminder email succeeds, also_sms logs Conversations SMS (Lecca From)", async () => {
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admins WHERE status = 'active' ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("Need an active admin");
    const adminId = Number(admins[0].id);

    const ofgE164 = `+1949${String(Date.now()).slice(-7)}`;
    const [pIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, ?, ?, 1, JSON_OBJECT('sms', TRUE))`,
      [ofgE164, `Reminder SMS ${RUN_ID}`, adminId],
    );
    const phoneNumberId = Number(pIns.insertId);

    const [prevSignup] = await pool.query<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings
       WHERE setting_key = 'signup_notify_sms_from_phone_number_id' LIMIT 1`,
    );
    const prevSignupVal =
      prevSignup[0]?.setting_value != null
        ? String(prevSignup[0].setting_value)
        : null;
    const [prevMaster] = await pool.query<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings
       WHERE setting_key = 'client_reminder_sms_enabled' LIMIT 1`,
    );
    const prevMasterVal =
      prevMaster[0]?.setting_value != null
        ? String(prevMaster[0].setting_value)
        : null;

    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('signup_notify_sms_from_phone_number_id', ?),
              ('client_reminder_sms_enabled', '1')
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [String(phoneNumberId)],
    );

    const clientPhone = `+1555${String(Date.now()).slice(-7)}`;
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language)
       VALUES ('RemSms', ?, ?, ?, 'onboarding', 'new_client', 'en')`,
      [RUN_ID, `remsms-${RUN_ID}@example.test`, clientPhone],
    );
    const clientId = Number(cIns.insertId);
    clientIds.push(clientId);

    const payload = JSON.stringify({
      also_sms: true,
      trigger_event: "docs_ready",
      portal_url: "https://example.test/portal",
    });
    const [qIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status, payload_json)
       VALUES (?, 'email', ?, ?, '<p>docs ready</p>', NOW() - INTERVAL 1 MINUTE, 'pending', ?)`,
      [
        clientId,
        `remsms-${RUN_ID}@example.test`,
        `Reminder SMS ${RUN_ID}`,
        payload,
      ],
    );
    const queueId = Number(qIns.insertId);

    // Master off → no SMS
    await pool.query(
      `UPDATE system_settings SET setting_value = '0'
       WHERE setting_key = 'client_reminder_sms_enabled'`,
    );
    await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);

    const [offMsgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.id FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND m.channel = 'sms' AND m.direction = 'outbound'`,
      [clientId],
    );
    expect(offMsgs.length).toBe(0);

    // Re-queue with master on
    await pool.query(
      `UPDATE system_settings SET setting_value = '1'
       WHERE setting_key = 'client_reminder_sms_enabled'`,
    );
    await pool.query(
      `UPDATE notification_queue
       SET status = 'pending', scheduled_for = NOW() - INTERVAL 1 MINUTE,
           provider_message_id = NULL, sent_at = NULL, error_message = NULL
       WHERE id = ?`,
      [queueId],
    );

    await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);

    const [msgs] = await pool.query<RowDataPacket[]>(
      `SELECT m.body, m.metadata_json, m.from_address, m.to_address, m.provider_message_id
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ? AND m.channel = 'sms' AND m.direction = 'outbound'
       ORDER BY m.id DESC LIMIT 1`,
      [clientId],
    );
    expect(msgs.length).toBe(1);
    expect(String(msgs[0].body || "")).toMatch(/docs are ready/i);
    expect(String(msgs[0].from_address || "")).toBe(ofgE164);
    expect(String(msgs[0].provider_message_id || "")).toMatch(/^dry-run-/);
    const meta =
      typeof msgs[0].metadata_json === "string"
        ? JSON.parse(msgs[0].metadata_json)
        : msgs[0].metadata_json;
    expect(meta?.reminder_sms).toBe(true);
    expect(meta?.trigger_event).toBe("docs_ready");

    // Cleanup conversations + restore settings
    await pool.query(
      `DELETE FROM conversation_messages WHERE conversation_id IN (
         SELECT id FROM conversations WHERE client_id = ?
       )`,
      [clientId],
    );
    await pool.query(`DELETE FROM conversations WHERE client_id = ?`, [
      clientId,
    ]);
    await pool.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [
      phoneNumberId,
    ]);
    if (prevSignupVal != null) {
      await pool.query(
        `UPDATE system_settings SET setting_value = ?
         WHERE setting_key = 'signup_notify_sms_from_phone_number_id'`,
        [prevSignupVal],
      );
    } else {
      await pool.query(
        `DELETE FROM system_settings
         WHERE setting_key = 'signup_notify_sms_from_phone_number_id'`,
      );
    }
    if (prevMasterVal != null) {
      await pool.query(
        `UPDATE system_settings SET setting_value = ?
         WHERE setting_key = 'client_reminder_sms_enabled'`,
        [prevMasterVal],
      );
    } else {
      await pool.query(
        `DELETE FROM system_settings
         WHERE setting_key = 'client_reminder_sms_enabled'`,
      );
    }
  }, 90_000);

  it("suppresses payment_confirmed upload nudges once required tasks are submitted", async () => {
    const [tplRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates
       WHERE is_active = 1 AND is_required = 1
       ORDER BY sort_order ASC, id ASC`,
    );
    expect(tplRows.length).toBeGreaterThan(0);

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('NudgeSkip', ?, ?, 'onboarding', 'new_client', 'en')`,
      [RUN_ID, `nudge-skip-${RUN_ID}@example.test`],
    );
    const clientId = Number(ins.insertId);
    clientIds.push(clientId);

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'new_client', 'active')`,
      [clientId],
    );
    const caseId = Number(caseIns.insertId);

    for (const tpl of tplRows) {
      await pool.query(
        `INSERT INTO client_task_completions
           (client_id, case_id, task_template_id, status, admin_review_status, completed_at)
         VALUES (?, ?, ?, 'completed', 'pending', NOW())
         ON DUPLICATE KEY UPDATE
           status = 'completed',
           admin_review_status = 'pending',
           completed_at = NOW()`,
        [clientId, caseId, Number(tpl.id)],
      );
    }

    expect(
      await __testShouldSuppressPaymentConfirmedUploadNudges(clientId),
    ).toBe(true);

    const [dueIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status, payload_json)
       VALUES (?, 'email', ?, ?, '<p>upload please</p>', NOW() - INTERVAL 1 MINUTE, 'pending', ?)`,
      [
        clientId,
        `nudge-skip-${RUN_ID}@example.test`,
        `Upload nudge ${RUN_ID}`,
        JSON.stringify({
          also_sms: true,
          trigger_event: "payment_confirmed",
          portal_url: "https://example.test/portal",
        }),
      ],
    );
    const dueId = Number(dueIns.insertId);

    const cancelledNow = await __testCancelPaymentConfirmedUploadNudges(clientId);
    expect(cancelledNow).toBeGreaterThanOrEqual(1);

    const [cancelledRow] = await pool.query<RowDataPacket[]>(
      `SELECT status, error_message FROM notification_queue WHERE id = ?`,
      [dueId],
    );
    expect(cancelledRow[0]?.status).toBe("cancelled");
    expect(String(cancelledRow[0]?.error_message || "")).toMatch(/submitted/i);

    // Re-queue a due row to exercise cron soft-skip (cancel already consumed the first).
    const [due2] = await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, status, payload_json)
       VALUES (?, 'email', ?, ?, '<p>upload please 2</p>', NOW() - INTERVAL 1 MINUTE, 'pending', ?)`,
      [
        clientId,
        `nudge-skip-${RUN_ID}@example.test`,
        `Upload nudge2 ${RUN_ID}`,
        JSON.stringify({
          also_sms: true,
          trigger_event: "payment_confirmed",
          portal_url: "https://example.test/portal",
        }),
      ],
    );
    const due2Id = Number(due2.insertId);

    __testClearEmailDryRuns();
    const res = await request(app)
      .get("/api/cron/process-queue")
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(Number(res.body.suppressed || 0)).toBeGreaterThanOrEqual(1);

    const [due2Row] = await pool.query<RowDataPacket[]>(
      `SELECT status, error_message FROM notification_queue WHERE id = ?`,
      [due2Id],
    );
    expect(due2Row[0]?.status).toBe("cancelled");
    expect(String(due2Row[0]?.error_message || "")).toMatch(/Skipped/i);

    const dry = __testGetEmailDryRuns().filter((e) =>
      e.subject.includes(`Upload nudge2 ${RUN_ID}`),
    );
    expect(dry.length).toBe(0);

    await pool.query(`DELETE FROM client_task_completions WHERE case_id = ?`, [
      caseId,
    ]);
  }, 90_000);
});
