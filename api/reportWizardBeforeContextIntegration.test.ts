/**
 * OFG Progress Report Wizard — before-context reuse + affiliate authz.
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

const RUN_ID = `rwiz-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let affiliateAdminId = 0;
let affiliateToken = "";
const clientIds: number[] = [];
const caseIds: number[] = [];
const sessionIds: number[] = [];
const adminIdsToDelete: number[] = [];
let seedSeq = 0;

describe("report wizard before-context + authz", () => {
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
    if (!admins[0]) throw new Error("No staff admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-rwiz",
    );

    const [affIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status)
       VALUES (?, 'Aff', ?, 'affiliate', 'active')`,
      [`aff.${RUN_ID}@example.com`, RUN_ID.slice(-6)],
    );
    affiliateAdminId = affIns.insertId;
    adminIdsToDelete.push(affiliateAdminId);
    affiliateToken = await createSession(
      "admin",
      affiliateAdminId,
      `aff.${RUN_ID}@example.com`,
      "127.0.0.1",
      "vitest-rwiz-aff",
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of sessionIds) {
      await pool.query(`DELETE FROM round_report_source_pdfs WHERE session_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM report_wizard_sessions WHERE id = ?`, [id]);
    }
    for (const id of caseIds) {
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id]);
    }
    for (const id of clientIds) {
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    for (const id of adminIdsToDelete) {
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [id]);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [id]);
    }
    await pool?.end();
  }, 90_000);

  async function seedCase(stage = "round_2") {
    seedSeq += 1;
    const email = `wiz.${RUN_ID}.${seedSeq}@example.com`;
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, phone, status, preferred_language)
       VALUES ('Wiz', ?, ?, ?, 'active', 'en')`,
      [`${RUN_ID.slice(-6)}${seedSeq}`, email, `55501${String(seedSeq).padStart(5, "0")}`],
    );
    const clientId = cIns.insertId;
    clientIds.push(clientId);
    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, ?, 'active')`,
      [clientId, stage],
    );
    const caseId = caseIns.insertId;
    caseIds.push(caseId);
    return { clientId, caseId };
  }

  it("before-context round 1 → enrollment", async () => {
    const { caseId } = await seedCase("round_1");
    const res = await request(app)
      .get(`/api/admin/cases/${caseId}/report-wizard/before-context`)
      .query({ round_number: 1 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.context.source).toBe("enrollment");
    expect(res.body.context.can_reuse).toBe(false);
  });

  it("before-context round 2 without published prior → none", async () => {
    const { caseId } = await seedCase("round_2");
    const res = await request(app)
      .get(`/api/admin/cases/${caseId}/report-wizard/before-context`)
      .query({ round_number: 2 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.context.source).toBe("none");
    expect(res.body.context.can_reuse).toBe(false);
    expect(res.body.context.prior_round).toBe(1);
  });

  it("before-context reuses published prior round after PDF", async () => {
    const { clientId, caseId } = await seedCase("round_2");
    const [sessIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, before_source,
          options_json, extracted_json, created_by_admin_id, published_at)
       VALUES (?, ?, 1, 'published', 'enrollment', '{}', ?, ?, NOW())`,
      [
        caseId,
        clientId,
        JSON.stringify({
          reportDate: { before: "2026-01-01", after: "2026-02-01" },
          middleScore: { before: 580, after: 610 },
        }),
        adminId,
      ],
    );
    const priorSessionId = sessIns.insertId;
    sessionIds.push(priorSessionId);

    const [pdfIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO round_report_source_pdfs
         (session_id, role, file_name, storage_key, encrypted, enc_iv, enc_tag, uploaded_by_admin_id)
       VALUES (?, 'after', 'r1-after.pdf', 'https://example.com/fake.enc', 1, ?, ?, ?)`,
      [priorSessionId, "00".repeat(16), "00".repeat(16), adminId],
    );
    await pool.query(
      `UPDATE report_wizard_sessions SET after_pdf_id = ? WHERE id = ?`,
      [pdfIns.insertId, priorSessionId],
    );

    const res = await request(app)
      .get(`/api/admin/cases/${caseId}/report-wizard/before-context`)
      .query({ round_number: 2 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.context.source).toBe("prior_round");
    expect(res.body.context.can_reuse).toBe(true);
    expect(res.body.context.prior_session_id).toBe(priorSessionId);
    expect(res.body.context.file_name).toBe("r1-after.pdf");
    expect(res.body.context.report_date_after).toBe("2026-02-01");
  });

  it("rejects reuse_before_session_id from another case", async () => {
    const a = await seedCase("round_2");
    const b = await seedCase("round_2");
    const [sessIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, before_source, created_by_admin_id, published_at)
       VALUES (?, ?, 1, 'published', 'enrollment', ?, NOW())`,
      [a.caseId, a.clientId, adminId],
    );
    sessionIds.push(sessIns.insertId);

    const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const res = await request(app)
      .post(`/api/admin/cases/${b.caseId}/report-wizard/sessions`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("round_number", "2")
      .field("reuse_before_session_id", String(sessIns.insertId))
      .attach("after_pdf", tinyPdf, "after.pdf")
      .expect(404);
    expect(String(res.body.error || "")).toMatch(/not found|Prior/i);
  });

  it("affiliate cannot GET session or source PDF", async () => {
    const { clientId, caseId } = await seedCase("round_1");
    const [sessIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO report_wizard_sessions
         (case_id, client_id, round_number, status, before_source, created_by_admin_id)
       VALUES (?, ?, 1, 'review', 'enrollment', ?)`,
      [caseId, clientId, adminId],
    );
    sessionIds.push(sessIns.insertId);

    await request(app)
      .get(`/api/admin/report-wizard/sessions/${sessIns.insertId}`)
      .set("Authorization", `Bearer ${affiliateToken}`)
      .expect(403);

    await request(app)
      .get(
        `/api/admin/report-wizard/sessions/${sessIns.insertId}/source/after`,
      )
      .set("Authorization", `Bearer ${affiliateToken}`)
      .expect(403);

    await request(app)
      .get(`/api/admin/cases/${caseId}/report-wizard/before-context`)
      .query({ round_number: 1 })
      .set("Authorization", `Bearer ${affiliateToken}`)
      .expect(403);
  });

  it("create without before_pdf and without reuse → 400", async () => {
    const { caseId } = await seedCase("round_1");
    const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/report-wizard/sessions`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("round_number", "1")
      .attach("after_pdf", tinyPdf, "after.pdf")
      .expect(400);
    expect(String(res.body.error || "")).toMatch(/before_pdf|reuse/i);
  });
});
