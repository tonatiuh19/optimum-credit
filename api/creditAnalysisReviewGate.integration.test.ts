/**
 * Credit Analysis review gate (Spec v2.1 §11 + Claude auditor; Claude passes
 * are skipped under vitest, so the self-check decides). A read that does not
 * reconcile with the report's own totals is never released to the client
 * until an admin approves it; a clean read is released automatically.
 * Real app + DB; rows are removed in afterAll.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, reviewCreditFile } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `review-gate-${Date.now()}`;
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "credit-files", "factual-data-trimerge-active-loan.json"), "utf8"),
);

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
const clientIds: number[] = [];

async function seed(file: unknown): Promise<{ analysisId: number; extractionId: number; token: string }> {
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (email, first_name, last_name, preferred_language, status, pipeline_stage)
     VALUES (?, 'Review', ?, 'en', 'prospect', 'prospect')`,
    [`vitest+${RUN_ID}-${clientIds.length}@example.com`, RUN_ID],
  );
  clientIds.push(Number(c.insertId));
  const token = (RUN_ID.replace(/[^a-f0-9]/g, "") + "a".repeat(32)).slice(0, 31) + String(clientIds.length);
  const [a] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_analyses (client_id, mode, text_language, email_opt_in, public_token, generated_at)
     VALUES (?, 'client', 'en', 0, ?, NOW())`,
    [c.insertId, token],
  );
  const [e] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_file_extractions
       (client_id, credit_analysis_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag,
        provider, status, extracted_json, completed_at, review_status)
     VALUES (?, ?, 'analysis', 'r.pdf', 'application/pdf', 1, 'vitest://none', REPEAT('0',32), REPEAT('0',32),
             'unknown', 'ready', ?, NOW(), 'pending')`,
    [c.insertId, a.insertId, JSON.stringify(file)],
  );
  return { analysisId: Number(a.insertId), extractionId: Number(e.insertId), token };
}

describe("credit analysis review gate", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status = 'active' AND role IN ('super_admin','admin') ORDER BY id ASC LIMIT 1`,
    );
    adminToken = await createSession("admin", Number(admins[0].id), String(admins[0].email), "127.0.0.1", `vitest-${RUN_ID}`);
  }, 30_000);

  afterAll(async () => {
    if (pool) {
      await cleanupIntegrationTestClients(pool, { runId: RUN_ID, clientIds });
      await pool.end();
    }
  }, 60_000);

  it("self-check fails (29 vs 28 accounts) → needs_review; client sees 'review', never the data", async () => {
    const s = await seed(FIXTURE);
    const out = await reviewCreditFile(s.extractionId);
    expect(out.status).toBe("needs_review");

    const pub = await request(app).get(`/api/public/credit-analyses/${s.token}/status`);
    expect(pub.body.status).toBe("review");
    expect((await request(app).get(`/api/public/credit-analyses/${s.token}/analysis`)).status).toBe(404);
    expect((await request(app).get(`/api/public/credit-analyses/${s.token}/pdf`)).status).toBe(404);

    const staff = await request(app)
      .get(`/api/admin/credit-analyses/${s.analysisId}/enhanced-status`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(staff.body.status).toBe("ready");
    expect(staff.body.review.status).toBe("needs_review");
    const acct = staff.body.review.findings.selfCheck.items.find((i: any) => i.key === "accounts");
    expect(acct).toMatchObject({ expected: "29", actual: "28", ok: false });

    // Running the review again on a decided read is a no-op.
    expect((await reviewCreditFile(s.extractionId)).status).toBe("skipped");

    // Admin approves → released to the client.
    const ok = await request(app)
      .post(`/api/admin/credit-analyses/${s.analysisId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve" });
    expect(ok.status).toBe(200);
    expect(ok.body.review_status).toBe("approved");
    const after = await request(app).get(`/api/public/credit-analyses/${s.token}/status`);
    expect(after.body.status).toBe("ready");
    const analysis = await request(app).get(`/api/public/credit-analyses/${s.token}/analysis`);
    expect(analysis.status).toBe(200);
    expect(analysis.body.analysis.lender).toBeNull();
  }, 60_000);

  it("clean read (totals reconcile) → passed and released automatically", async () => {
    const clean = { ...FIXTURE, summary: { ...FIXTURE.summary, totalAccounts: FIXTURE.accounts.length } };
    const s = await seed(clean);
    expect((await reviewCreditFile(s.extractionId)).status).toBe("passed");
    const pub = await request(app).get(`/api/public/credit-analyses/${s.token}/status`);
    expect(pub.body.status).toBe("ready");
    // Released: scores / labels written back onto the analysis row.
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT scores_json FROM credit_analyses WHERE id = ?`, [s.analysisId]);
    const scores = typeof row.scores_json === "string" ? JSON.parse(row.scores_json) : row.scores_json;
    expect(scores).toMatchObject({ transunion: 578, experian: 585, equifax: 634 });
  }, 60_000);

  it("re-run puts it back to pending; bad action is rejected", async () => {
    const s = await seed(FIXTURE);
    await reviewCreditFile(s.extractionId);
    const bad = await request(app)
      .post(`/api/admin/credit-analyses/${s.analysisId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "delete" });
    expect(bad.status).toBe(400);
    const rerun = await request(app)
      .post(`/api/admin/credit-analyses/${s.analysisId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "rerun" });
    expect(rerun.body.review_status).toBe("pending");
    // While pending the client keeps seeing "reading", never the data.
    const pub = await request(app).get(`/api/public/credit-analyses/${s.token}/status`);
    expect(pub.body.status).toBe("submitted");
  }, 60_000);

  it("internal review route requires the cron secret", async () => {
    expect((await request(app).post(`/api/internal/credit-file-review/1`)).status).toBe(401);
  });
});
