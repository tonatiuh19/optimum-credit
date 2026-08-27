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
  createServer,
  resolveLanguageOwnerAdminId,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

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
    process.env.CRON_SECRET = `vitest-cron-${RUN_ID}`;
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
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);
    expect(okGet.body.ok).toBe(true);

    const okPost = await request(app)
      .post("/api/cron/process-queue")
      .set("x-cron-secret", String(process.env.CRON_SECRET))
      .expect(200);
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
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.stale_cancelled).toBeGreaterThanOrEqual(1);
    expect(res.body.sent).toBeGreaterThanOrEqual(1);

    const [staleRow] = await pool.query<RowDataPacket[]>(
      `SELECT status, error_message FROM notification_queue WHERE id = ?`,
      [staleId],
    );
    expect(staleRow[0]?.status).toBe("cancelled");
    expect(String(staleRow[0]?.error_message || "")).toMatch(/stale/i);

    const [dueRow] = await pool.query<RowDataPacket[]>(
      `SELECT status, sent_at FROM notification_queue WHERE id = ?`,
      [dueId],
    );
    expect(dueRow[0]?.status).toBe("sent");
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
});
