/**
 * Integration / route tests for Client Info Requests.
 * Hits the real Express app + TiDB using createServer() + createSession().
 * Seeds an isolated client/case and deletes them in afterAll.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import {
  buildInfoRequestPresetFields,
  defaultInfoRequestTitles,
} from "../shared/infoRequestPresets";
import { createServer, createSession } from "./index";

const RUN_ID = `ir-test-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let clientId = 0;
let caseId = 0;
let adminId = 0;
let adminToken = "";
let clientToken = "";
let otherClientId = 0;
let otherClientToken = "";

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

describe("info requests — HTTP integration", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin user in DB for integration tests");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-info-requests",
    );

    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Info', 'Tester', '+15555550100', 'en', 'active', 'round_1')`,
      [CLIENT_EMAIL],
    );
    clientId = clientIns.insertId;

    const [caseIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
       VALUES (?, 'round_1', 'active', ?)`,
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
      "vitest-info-requests",
    );

    const [otherIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, preferred_language, status)
       VALUES (?, 'Other', 'Client', 'en', 'active')`,
      [`${RUN_ID}-other@example.test`],
    );
    otherClientId = otherIns.insertId;
    otherClientToken = await createSession(
      "client",
      otherClientId,
      `${RUN_ID}-other@example.test`,
      "127.0.0.1",
      "vitest-info-requests",
    );
  }, 60_000);

  afterAll(async () => {
    try {
      if (clientId) {
        await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
      }
      if (otherClientId) {
        await pool.query(`DELETE FROM clients WHERE id = ?`, [otherClientId]);
      }
      // revoke test sessions for this admin token is optional
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it("rejects unauthenticated create", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .send({ title_en: "x", title_es: "y", fields_json: [] });
    expect(res.status).toBe(401);
  });

  it("rejects client token on admin create", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        title_en: "Nope",
        title_es: "No",
        fields_json: buildInfoRequestPresetFields("custom"),
      });
    expect(res.status).toBe(401);
  });

  it("rejects create with empty fields / missing titles", async () => {
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title_en: "Only EN", title_es: "", fields_json: [] });
    expect(res.status).toBe(400);
  });

  let requestId = 0;

  it("admin creates a custom info request and notifies path succeeds", async () => {
    const titles = defaultInfoRequestTitles("custom");
    const res = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_key: "custom",
        title_en: titles.title_en,
        title_es: titles.title_es,
        message_en: titles.message_en,
        message_es: titles.message_es,
        fields_json: buildInfoRequestPresetFields("custom"),
      });
    expect(res.status).toBe(201);
    expect(res.body.request?.id).toBeTruthy();
    expect(res.body.request.status).toBe("open");
    requestId = res.body.request.id;
  });

  it("admin lists requests for the case", async () => {
    const res = await request(app)
      .get(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.requests.some((r: any) => r.id === requestId)).toBe(true);
  });

  it("pipeline includes info_requests_open count for the case", async () => {
    const res = await request(app)
      .get("/api/admin/pipeline")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const kase = (res.body.cases || []).find((c: any) => c.id === caseId);
    expect(kase).toBeTruthy();
    expect(Number(kase.info_requests_open)).toBeGreaterThanOrEqual(1);
  });

  it("portal list shows actionable request", async () => {
    const res = await request(app)
      .get("/api/portal/info-requests")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.actionable_count).toBeGreaterThanOrEqual(1);
    expect(res.body.requests.some((r: any) => r.id === requestId)).toBe(true);
  });

  it("other client cannot read this request", async () => {
    const res = await request(app)
      .get(`/api/portal/info-requests/${requestId}`)
      .set("Authorization", `Bearer ${otherClientToken}`);
    expect(res.status).toBe(404);
  });

  it("submit without consent is rejected", async () => {
    const res = await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "false")
      .field("agreed_sms", "true")
      .field("responses", JSON.stringify({ notes: "hello" }));
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Terms|SMS|agree/i);
  });

  it("submit with consent but missing required notes is rejected", async () => {
    const res = await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field("responses", JSON.stringify({ notes: "" }));
    expect(res.status).toBe(400);
  });

  it("submit with consent + notes succeeds", async () => {
    const res = await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({ notes: "Here is the information you asked for." }),
      );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
  });

  it("cannot submit again while already submitted", async () => {
    const res = await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field("responses", JSON.stringify({ notes: "again" }));
    expect(res.status).toBe(422);
  });

  it("admin reject without reason fails", async () => {
    const res = await request(app)
      .post(`/api/admin/info-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });
    expect(res.status).toBe(400);
  });

  it("admin rejects with reason", async () => {
    const res = await request(app)
      .post(`/api/admin/info-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "rejected",
        rejection_reason: "Please provide more detail.",
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
  });

  it("client can resubmit after rejection", async () => {
    const res = await request(app)
      .post(`/api/portal/info-requests/${requestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({
          notes: "Resubmitted with more detail about the account.",
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
  });

  it("admin approves resubmission", async () => {
    const res = await request(app)
      .post(`/api/admin/info-requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });

  it("cannot cancel an approved request", async () => {
    const res = await request(app)
      .post(`/api/admin/info-requests/${requestId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
  });

  it("approved request remains visible in portal history", async () => {
    const res = await request(app)
      .get("/api/portal/info-requests")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    const found = res.body.requests.find((r: any) => r.id === requestId);
    expect(found?.status).toBe("approved");
    expect(found?.response_json?.notes).toMatch(/Resubmitted/);
  });

  // ── Smart Credit secrets path ─────────────────────────────────────────────

  let scRequestId = 0;

  it("creates Smart Credit request and stores encrypted secrets", async () => {
    const titles = defaultInfoRequestTitles("smart_credit");
    const create = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_key: "smart_credit",
        ...titles,
        fields_json: buildInfoRequestPresetFields("smart_credit"),
      });
    expect(create.status).toBe(201);
    scRequestId = create.body.request.id;

    const submit = await request(app)
      .post(`/api/portal/info-requests/${scRequestId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({
          smart_credit: {
            email: "sc-user@example.com",
            password: "fixture-smartcredit-pw",
            security_question: "First pet?",
            security_answer: "Mochi",
          },
        }),
      );
    expect(submit.status).toBe(200);

    const detailNoSecrets = await request(app)
      .get(`/api/admin/info-requests/${scRequestId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detailNoSecrets.status).toBe(200);
    expect(detailNoSecrets.body.request.has_secrets).toBe(true);
    expect(detailNoSecrets.body.request.secrets_json).toBeNull();
    expect(
      JSON.stringify(detailNoSecrets.body.request.response_json),
    ).not.toContain("fixture-smartcredit-pw");

    const detailWithSecrets = await request(app)
      .get(`/api/admin/info-requests/${scRequestId}?include_secrets=1`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detailWithSecrets.status).toBe(200);
    expect(detailWithSecrets.body.request.secrets_json?.smart_credit).toMatchObject({
      email: "sc-user@example.com",
      password: "fixture-smartcredit-pw",
      security_answer: "Mochi",
    });

    // Portal must never receive secrets
    const portalDetail = await request(app)
      .get(`/api/portal/info-requests/${scRequestId}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portalDetail.body.request.secrets_json).toBeNull();
    expect(JSON.stringify(portalDetail.body)).not.toContain("fixture-smartcredit-pw");
  });

  it("approving Smart Credit stamps smart_credit_connected_at", async () => {
    const res = await request(app)
      .post(`/api/admin/info-requests/${scRequestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });
    expect(res.status).toBe(200);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT smart_credit_email, smart_credit_connected_at FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(rows[0].smart_credit_email).toBe("sc-user@example.com");
    expect(rows[0].smart_credit_connected_at).toBeTruthy();
  });

  // ── Billing confirm + cancel open request ─────────────────────────────────

  it(
    "billing confirm submit + cancel open request works",
    async () => {
    const titles = defaultInfoRequestTitles("payment_billing");
    const create = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_key: "payment_billing",
        ...titles,
        fields_json: buildInfoRequestPresetFields("payment_billing"),
      });
    expect(create.status).toBe(201);
    const billingId = create.body.request.id as number;

    const bad = await request(app)
      .post(`/api/portal/info-requests/${billingId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({
          billing_confirm: {
            address_line1: "1 Main",
            city: "Austin",
            state: "TX",
            postal_code: "78701",
            card_last4: "12",
          },
        }),
      );
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post(`/api/portal/info-requests/${billingId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field(
        "responses",
        JSON.stringify({
          billing_confirm: {
            address_line1: "1 Main St",
            city: "Austin",
            state: "TX",
            postal_code: "78701",
            card_last4: "4242",
          },
        }),
      );
    expect(ok.status).toBe(200);

    const approve = await request(app)
      .post(`/api/admin/info-requests/${billingId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });
    expect(approve.status).toBe(200);

    // Open request then cancel
    const openCreate = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_key: "custom",
        title_en: "Temp cancel me",
        title_es: "Cancelar temp",
        fields_json: buildInfoRequestPresetFields("custom"),
      });
    const cancelId = openCreate.body.request.id;
    const cancel = await request(app)
      .post(`/api/admin/info-requests/${cancelId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cancel.status).toBe(200);

    const list = await request(app)
      .get(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`);
    const cancelled = list.body.requests.find((r: any) => r.id === cancelId);
    expect(cancelled?.status).toBe("cancelled");
  },
    30_000,
  );

  it("payment_card without Accept.js opaque data is rejected", async () => {
    // payment_card preset deferred from admin UI; API still validates if used.
    const titles = defaultInfoRequestTitles("payment_card");
    const create = await request(app)
      .post(`/api/admin/cases/${caseId}/info-requests`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_key: "payment_card",
        ...titles,
        fields_json: buildInfoRequestPresetFields("payment_card"),
      });
    expect(create.status).toBe(201);
    const cardReqId = create.body.request.id;

    const res = await request(app)
      .post(`/api/portal/info-requests/${cardReqId}/submit`)
      .set("Authorization", `Bearer ${clientToken}`)
      .field("agreed_terms", "true")
      .field("agreed_sms", "true")
      .field("responses", JSON.stringify({}));
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/[Cc]ard/);
  });
});
