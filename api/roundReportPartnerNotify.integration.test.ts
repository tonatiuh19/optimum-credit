/**
 * Round PDF partner notify + admin resend (3A/4A/8A).
 * Requires DB_HOST + JWT_SECRET. Emails are vitest dry-runs.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  createServer,
  createSession,
  executeAdminAiTool,
} from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `rrpn-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let caseId = 0;
let referrerId = 0;
let roundReportId = 0;
let pdfId = 0;

describe("round report partner notify + resend", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for integration tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-round-partner-notify",
    );

    const [refIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO referrers
         (category, first_name, last_name, email, phone, preferred_language, status)
       VALUES ('realtor_broker', 'Liz', ?, ?, '+15555550999', 'en', 'active')`,
      [`Agent-${RUN_ID}`, `liz-${RUN_ID}@example.test`],
    );
    referrerId = Number(refIns.insertId);

    const [cliIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage, preferred_language,
          referral_category, referrer_id)
       VALUES ('Carmen', ?, ?, '5550199', 'active', 'round_1', 'es',
               'realtor_broker', ?)`,
      [`Test-${RUN_ID}`, `carmen-${RUN_ID}@example.test`, referrerId],
    );
    clientId = Number(cliIns.insertId);

    await pool.query(
      `INSERT INTO client_referrers (client_id, referrer_id, role, sort_order, notify_on_round)
       VALUES (?, ?, 'primary', 0, 1)`,
      [clientId, referrerId],
    );

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'round_1', 'active')`,
      [clientId],
    );
    caseId = Number(caseIns.insertId);
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR${caseId}`, caseId],
    );

    const [rrIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after,
          items_removed, items_disputed, summary_md, report_locale)
       VALUES (?, ?, 1, 580, 620, 2, 4, 'Partner notify fixture', 'en')`,
      [clientId, caseId],
    );
    roundReportId = Number(rrIns.insertId);

    const [pdfIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO round_report_pdfs
         (client_id, round_number, round_report_id, file_name, storage_key, storage_provider)
       VALUES (?, 1, ?, ?, ?, 'local')`,
      [
        clientId,
        roundReportId,
        `R1-${RUN_ID}.pdf`,
        `vitest://round-partner-${RUN_ID}.pdf`,
      ],
    );
    pdfId = Number(pdfIns.insertId);
  }, 60_000);

  afterAll(async () => {
    if (pdfId) {
      await pool
        .query(`DELETE FROM round_report_download_tokens WHERE pdf_id = ?`, [
          pdfId,
        ])
        .catch(() => {});
      await pool
        .query(`DELETE FROM round_report_pdfs WHERE id = ?`, [pdfId])
        .catch(() => {});
    }
    if (roundReportId) {
      await pool
        .query(`DELETE FROM client_round_reports WHERE id = ?`, [roundReportId])
        .catch(() => {});
    }
    if (caseId) {
      await pool
        .query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId])
        .catch(() => {});
    }
    if (clientId) {
      await pool
        .query(`DELETE FROM client_referrers WHERE client_id = ?`, [clientId])
        .catch(() => {});
      await pool
        .query(`DELETE FROM clients WHERE id = ?`, [clientId])
        .catch(() => {});
    }
    if (referrerId) {
      await pool
        .query(`DELETE FROM referrers WHERE id = ?`, [referrerId])
        .catch(() => {});
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId],
    });
    await pool?.end();
  }, 90_000);

  it("POST /resend defaults email client + partners with PDF attach", async () => {
    __testClearEmailDryRuns();
    const res = await request(app)
      .post(`/api/admin/round-report-pdfs/${pdfId}/resend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.email_sent).toBe(true);
    expect(res.body.notify_partners).toBe(true);
    expect(res.body.partners_linked).toBeGreaterThanOrEqual(1);
    expect(res.body.partners_with_email).toBeGreaterThanOrEqual(1);
    expect(res.body.partners_emailed).toBeGreaterThanOrEqual(1);
    expect(String(res.body.secure_pdf_url || "")).toContain(
      "/api/public/round-report-pdf/",
    );

    const dry = __testGetEmailDryRuns();
    const partnerMail = dry.find((d) =>
      String(d.to).includes(`liz-${RUN_ID}@example.test`),
    );
    expect(partnerMail).toBeTruthy();
    expect(partnerMail?.attachmentNames?.some((n) => /\.pdf$/i.test(n))).toBe(
      true,
    );
    // Partner preferred_language=en even though client is es
    expect(String(partnerMail?.subject || "")).toMatch(/Round 1/i);
  }, 60_000);

  it("POST /resend with notify_partners=false skips partners", async () => {
    __testClearEmailDryRuns();
    const res = await request(app)
      .post(`/api/admin/round-report-pdfs/${pdfId}/resend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notify_partners: false, also_sms: false });
    expect(res.status).toBe(200);
    expect(res.body.partners_emailed).toBe(0);
    expect(res.body.notify_partners).toBe(false);
    const dry = __testGetEmailDryRuns();
    expect(
      dry.some((d) => String(d.to).includes(`liz-${RUN_ID}@example.test`)),
    ).toBe(false);
  }, 60_000);

  it("MCP send_round_report dry-run includes partner stats; partners-only allowed", async () => {
    const dry = await executeAdminAiTool(
      "send_round_report",
      {
        client_id: clientId,
        pdf_id: pdfId,
        also_email: false,
        also_sms: false,
        notify_partners: true,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview?.notify_partners).toBe(true);
    expect((dry.data as any).preview?.partners_linked).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      (dry.data as any).preview?.partners_with_email,
    ).toBeGreaterThanOrEqual(1);

    __testClearEmailDryRuns();
    const confirmed = await executeAdminAiTool(
      "send_round_report",
      {
        client_id: clientId,
        pdf_id: pdfId,
        also_email: false,
        also_sms: false,
        notify_partners: true,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect((confirmed.data as any).email_sent).toBe(false);
    expect((confirmed.data as any).partners_emailed).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("legacy clients.referrer_id alone does not get PDF fan-out (3A)", async () => {
    await pool.query(`DELETE FROM client_referrers WHERE client_id = ?`, [
      clientId,
    ]);
    // keep clients.referrer_id pointing at Liz
    await pool.query(`UPDATE clients SET referrer_id = ? WHERE id = ?`, [
      referrerId,
      clientId,
    ]);

    __testClearEmailDryRuns();
    const res = await request(app)
      .post(`/api/admin/round-report-pdfs/${pdfId}/resend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ also_sms: false });
    expect(res.status).toBe(200);
    expect(res.body.partners_linked).toBe(0);
    expect(res.body.partners_emailed).toBe(0);
    const dry = __testGetEmailDryRuns();
    expect(
      dry.some((d) => String(d.to).includes(`liz-${RUN_ID}@example.test`)),
    ).toBe(false);

    // restore junction for cleanup consistency
    await pool.query(
      `INSERT INTO client_referrers (client_id, referrer_id, role, sort_order, notify_on_round)
       VALUES (?, ?, 'primary', 0, 1)`,
      [clientId, referrerId],
    );
  }, 60_000);

  it("hard-fails resend when PDF bytes cannot load and partners are requested", async () => {
    await pool.query(
      `UPDATE round_report_pdfs
       SET storage_key = ?, storage_provider = 'local'
       WHERE id = ?`,
      [`missing/path-${RUN_ID}.pdf`, pdfId],
    );
    const res = await request(app)
      .post(`/api/admin/round-report-pdfs/${pdfId}/resend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ also_sms: false, notify_partners: true });
    expect(res.status).toBe(500);
    expect(String(res.body.error || "")).toMatch(/PDF bytes/i);
    expect(res.body.code).toBe("pdf_load_failed");

    // restore vitest:// key so cleanup / other suites stay healthy
    await pool.query(
      `UPDATE round_report_pdfs
       SET storage_key = ?, storage_provider = 'local'
       WHERE id = ?`,
      [`vitest://round-partner-${RUN_ID}.pdf`, pdfId],
    );
  }, 60_000);
});
