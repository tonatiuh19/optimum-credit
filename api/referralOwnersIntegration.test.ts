/**
 * Integration: staff prospect create, language owner assign, referrers, round updates.
 * Requires DB_HOST + JWT_SECRET.
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
import { cleanupIntegrationTestClients } from "./testDbCleanup";

const RUN_ID = `ref-own-${Date.now()}`;
const PROSPECT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let clientId = 0;
let referrerId = 0;
let caseId = 0;

async function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectionLimit: 3,
  });
}

describe("referral owners + prospect create — HTTP smoke", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin user in DB for integration tests");
    adminId = Number(admins[0].id);
    // Ensure this admin owns EN so auto-assign is deterministic for the test
    await pool.query(
      `UPDATE admins SET preferred_language = 'en' WHERE id = ?`,
      [adminId],
    );
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-referral-owners",
    );
  }, 60_000);

  afterAll(async () => {
    if (caseId) {
      await pool.query(`DELETE FROM client_documents WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM client_task_completions WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [
        caseId,
      ]);
    }
    if (clientId) {
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    if (referrerId) {
      await pool.query(`DELETE FROM referrers WHERE id = ?`, [referrerId]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId],
    });
    await pool?.end();
  }, 90_000);

  it("creates a realtor referrer partner", async () => {
    const res = await request(app)
      .post("/api/admin/referrers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        category: "realtor_broker",
        first_name: "Pat",
        last_name: `Broker-${RUN_ID}`,
        email: `broker-${RUN_ID}@example.test`,
        preferred_language: "en",
      });
    expect(res.status).toBe(201);
    expect(res.body.referrer?.category).toBe("realtor_broker");
    referrerId = Number(res.body.referrer.id);
  }, 30_000);

  it("staff can create a prospect without credit analysis", async () => {
    const res = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Lead",
        last_name: RUN_ID,
        email: PROSPECT_EMAIL,
        phone: "5550100",
        status: "prospect",
        preferred_language: "en",
        referral_category: "realtor_broker",
        referrer_id: referrerId,
        admin_notes: "Manual lead — no analysis",
      });
    expect(res.status).toBe(201);
    expect(res.body.client.status).toBe("prospect");
    expect(res.body.client.pipeline_stage).toBe("prospect");
    expect(res.body.client.preferred_language).toBe("en");
    expect(res.body.client.referral_category).toBe("realtor_broker");
    expect(Number(res.body.client.referrer_id)).toBe(referrerId);
    expect(Number(res.body.client.assigned_admin_id)).toBe(adminId);
    clientId = Number(res.body.client.id);

    const [labels] = await pool.query<RowDataPacket[]>(
      `SELECT l.slug FROM client_labels cl
       JOIN labels l ON l.id = cl.label_id
       WHERE cl.client_id = ?`,
      [clientId],
    );
    expect(labels.some((l) => l.slug === "realtor_broker")).toBe(true);
  }, 30_000);

  it("prospect appears on pipeline prospects list", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = (res.body.prospects || []).find(
      (p: { id: number }) => Number(p.id) === clientId,
    );
    expect(found).toBeTruthy();
  }, 30_000);

  it("rejects creating a case for a prospect (must convert)", async () => {
    const res = await request(app)
      .post("/api/admin/cases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ client_id: clientId, pipeline_stage: "new_client" });
    expect(res.status).toBe(409);
  }, 30_000);

  it("converts prospect and notifies path stays healthy", async () => {
    const res = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "Converted in test" });
    expect(res.status).toBe(200);
    expect(res.body.case?.id).toBeTruthy();
    caseId = Number(res.body.case.id);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(rows[0].status).not.toBe("prospect");
    expect(rows[0].pipeline_stage).toBe("new_client");
  }, 30_000);

  it("advances to round_1 without error (referrer round update best-effort)", async () => {
    expect(caseId).toBeGreaterThan(0);
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/stage`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stage: "round_1" });
    // docs_ready gate may block some transitions; never 500.
    expect([200, 422]).toContain(res.status);
  }, 30_000);

  it("allows phone-only prospect create; rejects neither email nor phone", async () => {
    const reject = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "No",
        last_name: "Contact",
        status: "prospect",
        preferred_language: "en",
      });
    expect(reject.status).toBe(400);
    expect(reject.body.code).toBe("contact_required");

    const ok = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Phone",
        last_name: `Only-${RUN_ID}`,
        phone: "+15555550987",
        status: "prospect",
        preferred_language: "en",
      });
    expect(ok.status).toBe(201);
    expect(ok.body.client?.email == null || ok.body.client.email === "").toBe(
      true,
    );
    expect(ok.body.client?.phone).toBe("+15555550987");
    const phoneOnlyId = Number(ok.body.client.id);
    await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [
      phoneOnlyId,
    ]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [phoneOnlyId]);
  }, 30_000);
});
