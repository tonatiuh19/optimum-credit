/**
 * Prospect credit analysis — admin + portal HTTP routes.
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
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `credit-analysis-${Date.now()}`;
const PROSPECT_EMAIL = `prospect-${RUN_ID}@example.test`;
const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let prospectId = 0;
let clientToken = "";

describe("credit analysis integration", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      `vitest-${RUN_ID}`,
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Credit', ?, '5550101999', 'en', 'prospect', 'prospect')`,
      [PROSPECT_EMAIL, RUN_ID],
    );
    prospectId = ins.insertId;
    clientToken = await createSession(
      "client",
      prospectId,
      PROSPECT_EMAIL,
      "127.0.0.1",
      `vitest-client-${RUN_ID}`,
    );

    const [colRows] = await pool.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM credit_analyses LIKE 'extraction_status'`,
    );
    if (colRows.length === 0) {
      await pool.query(
        `ALTER TABLE credit_analyses
           ADD COLUMN extraction_status ENUM('ok','empty','parse_failed','unsupported_type') DEFAULT NULL
             AFTER provider_detected`,
      );
      await pool.query(
        `ALTER TABLE credit_analyses
           ADD COLUMN chars_extracted INT UNSIGNED NOT NULL DEFAULT 0
             AFTER extraction_status`,
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (prospectId) {
      await pool.query(`DELETE FROM credit_analyses WHERE client_id = ?`, [
        prospectId,
      ]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: prospectId ? [prospectId] : [],
    });
    await pool?.end();
  }, 90_000);

  it("admin POST runs analysis for prospect and GET returns it", async () => {
    const post = await request(app)
      .post(`/api/admin/clients/${prospectId}/credit-analysis`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("text_language", "en")
      .field("email_opt_in", "false")
      .attach("report_file", tinyPdf, {
        filename: `report-${RUN_ID}.pdf`,
        contentType: "application/pdf",
      });

    expect(post.status).toBe(200);
    expect(post.body.id).toBeGreaterThan(0);
    expect(post.body.extraction_status).toBeDefined();
    expect(post.body.client_id).toBe(prospectId);
    // Vitest skips Anthropic; flag must still be present and false.
    expect(post.body.claude_enhanced).toBe(false);

    const get = await request(app)
      .get(`/api/admin/clients/${prospectId}/credit-analysis`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(get.status).toBe(200);
    expect(get.body.analysis?.id).toBe(post.body.id);
    expect(get.body.analysis?.claude_enhanced).toBe(false);
    expect(get.body.analysis?.analyst?._claude_enhanced).toBeUndefined();

    // Enhancement: the same upload is queued (background) for the enhanced
    // account-level read, linked to this analysis. Response above unchanged.
    let queued: number | null = null;
    for (let i = 0; i < 20 && queued === null; i++) {
      const [rows] = await pool.query<any[]>(
        `SELECT id, status, purpose FROM credit_file_extractions
         WHERE credit_analysis_id = ? LIMIT 1`,
        [post.body.id],
      );
      if (rows[0]) {
        expect(rows[0].purpose).toBe("analysis");
        expect(rows[0].status).toBe("queued");
        queued = Number(rows[0].id);
      } else {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    expect(queued).not.toBeNull();
  }, 60_000);

  it("portal POST + GET for prospect", async () => {
    const post = await request(app)
      .post("/api/portal/credit-analysis")
      .set("Authorization", `Bearer ${clientToken}`)
      .field("text_language", "en")
      .attach("report_file", tinyPdf, {
        filename: `portal-${RUN_ID}.pdf`,
        contentType: "application/pdf",
      });

    expect(post.status).toBe(200);
    expect(post.body.client_id).toBe(prospectId);

    const get = await request(app)
      .get("/api/portal/credit-analysis")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(get.status).toBe(200);
    expect(get.body.analysis?.client_id).toBe(prospectId);
  }, 60_000);

  it("rejects POST after convert but GET retains analysis", async () => {
    await pool.query(
      `UPDATE clients SET status = 'active', pipeline_stage = 'new_client' WHERE id = ?`,
      [prospectId],
    );

    const adminPost = await request(app)
      .post(`/api/admin/clients/${prospectId}/credit-analysis`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("text_language", "en")
      .attach("report_file", tinyPdf, {
        filename: `after-convert-${RUN_ID}.pdf`,
        contentType: "application/pdf",
      });
    expect(adminPost.status).toBe(403);
    expect(adminPost.body.code).toBe("prospect_only");

    const portalPost = await request(app)
      .post("/api/portal/credit-analysis")
      .set("Authorization", `Bearer ${clientToken}`)
      .attach("report_file", tinyPdf, {
        filename: `portal-after-${RUN_ID}.pdf`,
        contentType: "application/pdf",
      });
    expect(portalPost.status).toBe(403);

    const portalGet = await request(app)
      .get("/api/portal/credit-analysis")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portalGet.status).toBe(200);
    expect(portalGet.body.analysis).not.toBeNull();

    const adminGet = await request(app)
      .get(`/api/admin/clients/${prospectId}/credit-analysis`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.analysis).not.toBeNull();
  }, 45_000);

  it("rejects oversized upload with friendly 413", async () => {
    await pool.query(
      `UPDATE clients SET status = 'prospect', pipeline_stage = 'prospect' WHERE id = ?`,
      [prospectId],
    );
    const over = Buffer.alloc(4 * 1024 * 1024 + 1, 0);
    const res = await request(app)
      .post(`/api/admin/clients/${prospectId}/credit-analysis`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("report_file", over, {
        filename: `big-${RUN_ID}.pdf`,
        contentType: "application/pdf",
      });
    expect(res.status).toBe(413);
    expect(String(res.body.error || "")).toMatch(/4\s*MB|smaller/i);
  }, 45_000);
});
