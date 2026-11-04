/**
 * Credit file extraction jobs — upload → queued job (Claude runs from cron).
 * Uses the real app + DB; the CDN is the vitest in-memory map.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";
import { FILE } from "./creditAnalysisFixtures";
import type { ResultSetHeader } from "mysql2/promise";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
const jobIds: number[] = [];

describe("credit file extraction jobs", () => {
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
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-cfe",
    );
  });

  afterAll(async () => {
    if (jobIds.length) {
      await pool.query(`DELETE FROM credit_file_extractions WHERE id IN (?)`, [jobIds]);
    }
    await pool.end();
  });

  it("queues an image upload (any provider) and reports its status", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const res = await request(app)
      .post("/api/admin/credit-files")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("purpose", "analysis")
      .attach("file", png, { filename: "report-photo.png", contentType: "image/png" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.provider).toBe("unknown");
    jobIds.push(res.body.id);

    const get = await request(app)
      .get(`/api/admin/credit-files/${res.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      status: "queued",
      mime_type: "image/png",
      purpose: "analysis",
      credit_file: null,
      issues: [],
    });
  });

  it("rejects unsupported file types", async () => {
    const res = await request(app)
      .post("/api/admin/credit-files")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF or an image/);
  });

  it("requires a file", async () => {
    const res = await request(app)
      .post("/api/admin/credit-files")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("purpose", "analysis");
    expect(res.status).toBe(400);
  });

  it("serves the analysis JSON + PDF once the extraction is ready", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_file_extractions
         (purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag,
          provider, status, extracted_json)
       VALUES ('analysis', 'r.pdf', 'application/pdf', 1, 'vitest://none',
               REPEAT('0',32), REPEAT('0',32), 'smartcredit', 'ready', ?)`,
      [JSON.stringify({ ...FILE, borrowerName: "MARIA T LEDESMA" })],
    );
    jobIds.push(ins.insertId);
    // P0-1: a read with no borrower name and no client is never rendered (staff review).
    const [noName] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_file_extractions
         (purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag,
          provider, status, extracted_json)
       VALUES ('analysis', 'r.pdf', 'application/pdf', 1, 'vitest://none',
               REPEAT('0',32), REPEAT('0',32), 'smartcredit', 'ready', ?)`,
      [JSON.stringify(FILE)],
    );
    jobIds.push(noName.insertId);
    const blocked = await request(app)
      .get(`/api/admin/credit-files/${noName.insertId}/analysis.pdf`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(blocked.status).toBe(409);
    const json = await request(app)
      .get(`/api/admin/credit-files/${ins.insertId}/analysis`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(json.status).toBe(200);
    expect(json.body.analysis.missingBureaus).toEqual(["EQ"]);
    expect(json.body.analysis.negatives.length).toBe(4);

    const pdf = await request(app)
      .get(`/api/admin/credit-files/${ins.insertId}/analysis.pdf?lang=es`)
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("answers 409 while the report is still being read", async () => {
    const queuedId = jobIds[0];
    const res = await request(app)
      .get(`/api/admin/credit-files/${queuedId}/analysis`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it("existing analysis Download PDF: falls back until ready, then serves the enhanced PDF", async () => {
    const [cIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage)
       VALUES ('Enh', 'Pdf', ?, 'prospect', 'prospect')`,
      [`enh-pdf-${Date.now()}@example.test`],
    );
    const clientId = cIns.insertId;
    const [aIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_analyses (client_id, mode) VALUES (?, 'agent')`,
      [clientId],
    );
    const analysisId = aIns.insertId;
    try {
      // No enhanced read yet → status null + fallback.
      const none = await request(app)
        .get(`/api/admin/credit-analyses/${analysisId}/enhanced-status`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(none.body).toMatchObject({ status: null, context: { escrow: null, lender_score: null } });
      const fb = await request(app)
        .get(`/api/admin/credit-analyses/${analysisId}/enhanced-pdf`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(fb.status).toBe(404);
      expect(fb.body.fallback).toBe(true);

      // Ready → enhanced PDF.
      const [eIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO credit_file_extractions
           (client_id, credit_analysis_id, purpose, file_name, mime_type, file_size,
            storage_key, enc_iv, enc_tag, provider, status, extracted_json)
         VALUES (?, ?, 'analysis', 'r.pdf', 'application/pdf', 1, 'vitest://none',
                 REPEAT('0',32), REPEAT('0',32), 'smartcredit', 'ready', ?)`,
        [clientId, analysisId, JSON.stringify(FILE)],
      );
      jobIds.push(eIns.insertId);
      const ready = await request(app)
        .get(`/api/admin/credit-analyses/${analysisId}/enhanced-status`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(ready.body).toMatchObject({ status: "ready" });
      const pdf = await request(app)
        .get(`/api/admin/credit-analyses/${analysisId}/enhanced-pdf`)
        .set("Authorization", `Bearer ${adminToken}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      // P2-3: [LastName]_OFG_Credit_Analysis_[MonYYYY].pdf
      expect(pdf.headers["content-disposition"]).toMatch(/Pdf_OFG_Credit_Analysis_[A-Z][a-z]{2}\d{4}\.pdf/);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

      // Agent context: escrow + lender score (validated; affects the PDF).
      const ctx = await request(app)
        .patch(`/api/admin/credit-analyses/${analysisId}/context`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ escrow: true, lender_score_model: "FICO", lender_score: 630, lender_target_score: 660 });
      expect(ctx.status).toBe(200);
      expect(ctx.body.context).toEqual({ escrow: true, lender_score_model: "FICO", lender_score: 630, lender_target_score: 660 });
      const bad = await request(app)
        .patch(`/api/admin/credit-analyses/${analysisId}/context`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ lender_score: 99 });
      expect(bad.status).toBe(400);
      const back = await request(app)
        .patch(`/api/admin/credit-analyses/${analysisId}/context`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ escrow: null });
      expect(back.body.context.escrow).toBeNull();
      const status = await request(app)
        .get(`/api/admin/credit-analyses/${analysisId}/enhanced-status`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(status.body.context).toMatchObject({ escrow: null, lender_score: 630 });

      // Public form / portal: new-engine result by secure token only.
      const token = "b".repeat(32);
      await pool.query(`UPDATE credit_analyses SET public_token = ? WHERE id = ?`, [token, analysisId]);
      const pst = await request(app).get(`/api/public/credit-analyses/${token}/status`);
      expect(pst.status).toBe(200);
      expect(pst.body).toEqual({ status: "ready" });
      const pan = await request(app).get(`/api/public/credit-analyses/${token}/analysis`);
      expect(pan.status).toBe(200);
      expect(Array.isArray(pan.body.analysis.negatives)).toBe(true);
      expect(pan.body.analysis.lender).toBeNull(); // agent-only context hidden
      const ppdf = await request(app)
        .get(`/api/public/credit-analyses/${token}/pdf`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(ppdf.status).toBe(200);
      expect((ppdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
      // Wrong / malformed token → 404, never another client's analysis.
      expect((await request(app).get(`/api/public/credit-analyses/${"c".repeat(32)}/status`)).status).toBe(404);
      expect((await request(app).get(`/api/public/credit-analyses/${analysisId}/analysis`)).status).toBe(404);
    } finally {
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
  });
});

