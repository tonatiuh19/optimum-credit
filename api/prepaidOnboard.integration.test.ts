/**
 * Prepaid onboard invite — mint + redeem → New Client.
 * Requires DB_HOST + JWT_SECRET.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `prepaid-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
const clientIds: number[] = [];
let packageId = 0;

describe("prepaid onboard invites — HTTP", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin user in DB");
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-prepaid",
    );
    const [pkgs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM packages ORDER BY id ASC LIMIT 1`,
    );
    if (!pkgs[0]) throw new Error("No packages in DB");
    packageId = Number(pkgs[0].id);
  }, 60_000);

  afterAll(async () => {
    for (const id of clientIds) {
      await pool.query(`DELETE FROM reminder_flow_executions WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM client_task_completions WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(
        `DELETE FROM payment_split_tokens WHERE split_id IN (
           SELECT id FROM payment_splits WHERE client_id = ?
         )`,
        [id],
      );
      await pool.query(`DELETE FROM payments WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM payment_splits WHERE client_id = ?`, [id]);
      await pool.query(
        `UPDATE prepaid_onboard_invites
         SET redeemed_client_id = NULL, redeemed_case_id = NULL
         WHERE redeemed_client_id = ?`,
        [id],
      );
      await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await pool.query(
      `DELETE FROM prepaid_onboard_invites WHERE staff_notes LIKE ?`,
      [`%${RUN_ID}%`],
    );
    await cleanupIntegrationTestClients(pool, { runId: RUN_ID, clientIds });
    await pool?.end();
  }, 90_000);

  it("mints invite, public preview, redeems into new_client with paid + remaining splits", async () => {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 14);
    const dueYmd = due.toISOString().slice(0, 10);

    const minted = await request(app)
      .post("/api/admin/prepaid-onboard-invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        package_id: packageId,
        paid_amount_cents: 49900,
        paid_label: "Enrollment (prepaid)",
        payment_method: "zelle",
        payment_note: `vitest ${RUN_ID}`,
        staff_notes: `edge ${RUN_ID}`,
        preferred_language: "en",
        remaining_splits: [
          {
            label: "Balance",
            amount_cents: 20000,
            due_date: dueYmd,
            send_payment_link: false,
          },
        ],
      })
      .expect(201);

    expect(minted.body.invite?.url).toMatch(/\/join\//);
    expect(minted.body.invite?.token).toBeTruthy();
    const rawToken = String(minted.body.invite.token);

    const preview = await request(app)
      .get(`/api/public/prepaid-onboard/${rawToken}`)
      .expect(200);
    expect(preview.body.paid_amount_cents).toBe(49900);
    expect(preview.body.remaining_count).toBe(1);

    const email = `${RUN_ID}-join@example.test`;
    const redeemed = await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "Prepaid",
        last_name: "Join",
        email,
        phone: "+15555550177",
        preferred_language: "en",
      })
      .expect(201);

    expect(redeemed.body.token).toBeTruthy();
    expect(redeemed.body.case?.case_number).toMatch(/^CR-/);
    expect(redeemed.body.redirect).toBe("/portal/documents");
    const clientId = Number(redeemed.body.user.id);
    clientIds.push(clientId);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(clients[0].status).toBe("onboarding");
    expect(clients[0].pipeline_stage).toBe("new_client");

    const [cases] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage, status FROM credit_repair_cases WHERE client_id = ? AND status = 'active'`,
      [clientId],
    );
    expect(cases.length).toBe(1);
    expect(cases[0].pipeline_stage).toBe("new_client");

    const [splits] = await pool.query<RowDataPacket[]>(
      `SELECT status, amount_cents, label FROM payment_splits WHERE client_id = ? ORDER BY id ASC`,
      [clientId],
    );
    expect(splits.length).toBe(2);
    expect(splits[0].status).toBe("paid");
    expect(Number(splits[0].amount_cents)).toBe(49900);
    expect(splits[1].status).toBe("pending");
    expect(Number(splits[1].amount_cents)).toBe(20000);

    // Single-use
    await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "Again",
        last_name: "Nope",
        email: `${RUN_ID}-again@example.test`,
      })
      .expect(410);
  }, 60_000);

  it("blocks redeem when email already has enrolled active case", async () => {
    const email = `${RUN_ID}-dup@example.test`;
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('Dup', 'Client', ?, 'onboarding', 'new_client', 'en')`,
      [email],
    );
    const clientId = Number(ins.insertId);
    clientIds.push(clientId);
    await pool.query(
      `INSERT INTO credit_repair_cases (client_id, package_id, pipeline_stage, status)
       VALUES (?, ?, 'new_client', 'active')`,
      [clientId, packageId],
    );

    const minted = await request(app)
      .post("/api/admin/prepaid-onboard-invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        package_id: packageId,
        paid_amount_cents: 10000,
        payment_method: "cash",
        staff_notes: `dup ${RUN_ID}`,
      })
      .expect(201);
    const rawToken = String(minted.body.invite.token);

    const res = await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "Dup",
        last_name: "Attempt",
        email,
      })
      .expect(409);
    expect(String(res.body.code || res.body.error)).toMatch(/already_client|already/i);
  }, 45_000);

  it("requires email on redeem", async () => {
    const minted = await request(app)
      .post("/api/admin/prepaid-onboard-invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        package_id: packageId,
        paid_amount_cents: 5000,
        payment_method: "other",
        staff_notes: `no-email ${RUN_ID}`,
      })
      .expect(201);
    const rawToken = String(minted.body.invite.token);
    const res = await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "No",
        last_name: "Email",
        phone: "+15555550999",
      })
      .expect(400);
    expect(String(res.body.code || res.body.error)).toMatch(/email/i);
  });

  it("revoked invite cannot be redeemed", async () => {
    const minted = await request(app)
      .post("/api/admin/prepaid-onboard-invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        package_id: packageId,
        paid_amount_cents: 7500,
        payment_method: "venmo",
        staff_notes: `revoke ${RUN_ID}`,
      })
      .expect(201);
    const inviteId = Number(minted.body.invite.id);
    const rawToken = String(minted.body.invite.token);

    await request(app)
      .post(`/api/admin/prepaid-onboard-invites/${inviteId}/revoke`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .get(`/api/public/prepaid-onboard/${rawToken}`)
      .expect(410);

    await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "Revoked",
        last_name: "User",
        email: `${RUN_ID}-revoked@example.test`,
      })
      .expect(410);
  });

  it("promotes an existing prospect and returns a usable portal session", async () => {
    const email = `${RUN_ID}-prospect@example.test`;
    const lead = await request(app)
      .post("/api/public/prospect-lead")
      .send({
        first_name: "Prospect",
        last_name: "Promote",
        email,
        phone: "+15555550188",
        source_label: "web_analysis",
      })
      .expect(200);
    const prospectId = Number(lead.body.client_id);
    clientIds.push(prospectId);

    const minted = await request(app)
      .post("/api/admin/prepaid-onboard-invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        package_id: packageId,
        paid_amount_cents: 30000,
        payment_method: "zelle",
        staff_notes: `prospect ${RUN_ID}`,
      })
      .expect(201);
    const rawToken = String(minted.body.invite.token);

    const redeemed = await request(app)
      .post(`/api/public/prepaid-onboard/${rawToken}`)
      .send({
        first_name: "Prospect",
        last_name: "Promote",
        email,
        phone: "+15555550188",
      })
      .expect(201);

    expect(Number(redeemed.body.user.id)).toBe(prospectId);
    expect(redeemed.body.token).toBeTruthy();

    const me = await request(app)
      .get("/api/auth/client/me")
      .set("Authorization", `Bearer ${redeemed.body.token}`)
      .expect(200);
    expect(Number(me.body.user?.id || me.body.id)).toBe(prospectId);

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [prospectId],
    );
    expect(clients[0].status).toBe("onboarding");
    expect(clients[0].pipeline_stage).toBe("new_client");
  }, 60_000);
});
