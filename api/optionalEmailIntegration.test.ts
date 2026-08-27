/**
 * Optional client email — create/update/convert/affiliate/bulk-validate edges.
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
import { cleanupIntegrationTestClients, createIntegrationTestPool, withDbRetry } from "./testDbCleanup";

const RUN_ID = `opt-email-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
const clientIds: number[] = [];
const caseIds: number[] = [];

describe("optional client email — edges", () => {
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
    if (!admins[0]) throw new Error("No admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-opt-email",
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of caseIds) {
      await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM payment_splits WHERE case_id = ?`, [id]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [id]);
    }
    for (const id of clientIds) {
      await pool.query(`DELETE FROM client_labels WHERE client_id = ?`, [id]);
      await pool.query(`DELETE FROM notification_queue WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [
        id,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds,
    });
    await pool?.end();
  }, 90_000);

  it("rejects create with neither email nor phone", async () => {
    const res = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "No",
        last_name: "Contact",
        status: "prospect",
        preferred_language: "en",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("contact_required");
  });

  it("creates phone-only prospect and converts without crashing welcome email", async () => {
    const create = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Phone",
        last_name: `Conv-${RUN_ID}`,
        phone: "+15555550111",
        status: "prospect",
        preferred_language: "en",
      })
      .expect(201);
    const clientId = Number(create.body.client.id);
    clientIds.push(clientId);
    expect(create.body.client.email == null || create.body.client.email === "").toBe(
      true,
    );

    const conv = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "phone-only convert" });
    expect(conv.status).toBe(200);
    expect(conv.body.case?.id).toBeTruthy();
    caseIds.push(Number(conv.body.case.id));
  }, 45_000);

  it("update cannot clear both email and phone", async () => {
    const create = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Keep",
        last_name: `Contact-${RUN_ID}`,
        email: `keep-${RUN_ID}@example.test`,
        phone: "+15555550112",
        status: "prospect",
        preferred_language: "en",
      })
      .expect(201);
    const clientId = Number(create.body.client.id);
    clientIds.push(clientId);

    const clearBoth = await request(app)
      .put(`/api/admin/clients/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "", phone: "" });
    expect(clearBoth.status).toBe(400);
    expect(clearBoth.body.code).toBe("contact_required");

    const clearEmail = await request(app)
      .put(`/api/admin/clients/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "", phone: "+15555550112" })
      .expect(200);
    expect(
      clearEmail.body.client.email == null ||
        clearEmail.body.client.email === "",
    ).toBe(true);
  }, 30_000);

  it("task remind returns 422 when client has no email", async () => {
    const create = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Remind",
        last_name: `NoMail-${RUN_ID}`,
        phone: "+15555550113",
        status: "prospect",
        preferred_language: "en",
      })
      .expect(201);
    const clientId = Number(create.body.client.id);
    clientIds.push(clientId);

    const conv = await request(app)
      .post(`/api/admin/prospects/${clientId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(200);
    const caseId = Number(conv.body.case.id);
    caseIds.push(caseId);

    const [tpls] = await withDbRetry(() =>
      pool.query<RowDataPacket[]>(
        `SELECT id FROM onboarding_task_templates WHERE is_active = 1 LIMIT 1`,
      ),
    );
    expect(tpls[0]?.id).toBeTruthy();

    const remind = await request(app)
      .post(`/api/admin/cases/${caseId}/tasks/${tpls[0].id}/remind`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(remind.status).toBe(422);
    expect(String(remind.body.error || "")).toMatch(/email/i);
  }, 45_000);

  it("split reminders are not queued when client has no email", async () => {
    const create = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Split",
        last_name: `NoMail-${RUN_ID}`,
        phone: "+15555550114",
        status: "onboarding",
        preferred_language: "en",
        create_case: true,
      });
    // may be 201; if create_case needs non-prospect status
    expect([200, 201]).toContain(create.status);
    const clientId = Number(create.body.client.id);
    clientIds.push(clientId);

    let caseId = Number(create.body.case?.id || 0);
    if (!caseId) {
      const [cases] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM credit_repair_cases WHERE client_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [clientId],
      );
      if (!cases[0]) {
        const [ins] = await pool.query<ResultSetHeader>(
          `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status, notes)
           VALUES (?, 'new_client', 'active', ?)`,
          [clientId, RUN_ID],
        );
        caseId = ins.insertId;
        await pool.query(
          `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
          [`CR-T${String(caseId).padStart(5, "0")}`, caseId],
        );
      } else {
        caseId = Number(cases[0].id);
      }
    }
    caseIds.push(caseId);

    // Ensure email is null
    await pool.query(`UPDATE clients SET email = NULL WHERE id = ?`, [
      clientId,
    ]);

    const [flows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flows WHERE trigger_event = 'payment_due' AND is_active = 1 LIMIT 1`,
    );
    const flowId = flows[0] ? Number(flows[0].id) : null;

    const due = new Date();
    due.setDate(due.getDate() + 14);
    const dueStr = due.toISOString().slice(0, 10);

    const splitRes = await request(app)
      .post(`/api/admin/cases/${caseId}/splits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: "Phone-only installment",
        amount_cents: 10000,
        due_date: dueStr,
        send_payment_link: true,
        reminder_flow_id: flowId,
      })
      .expect(201);

    const splitId = Number(splitRes.body.split.id);
    const [queued] = await pool.query<RowDataPacket[]>(
      `SELECT id, to_address FROM notification_queue
       WHERE client_id = ? AND payload_json->>'$.split_id' = ?
         AND status = 'pending'`,
      [clientId, String(splitId)],
    );
    expect(queued.length).toBe(0);
  }, 60_000);

  it("bulk CSV validation accepts phone-only rows", async () => {
    const csv = [
      "first_name,last_name,email,phone,status,preferred_language",
      `PhoneOnly,Bulk${RUN_ID},,5555550115,pending_payment,en`,
      `NoContact,Bulk${RUN_ID},,,pending_payment,en`,
    ].join("\n");

    const res = await request(app)
      .post("/api/admin/bulk-import/validate")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", Buffer.from(csv, "utf8"), "clients.csv");

    expect(res.status).toBe(200);
    const rows = res.body.preview_rows as Array<{
      display_name: string;
      status: string;
      message?: string;
    }>;
    const phoneOnly = rows.find((r) => r.display_name.startsWith("PhoneOnly"));
    const noContact = rows.find((r) => r.display_name.startsWith("NoContact"));
    expect(phoneOnly?.status).toBe("will_create");
    expect(noContact?.status).toBe("error");
    expect(String(noContact?.message || "")).toMatch(/email or phone/i);
  }, 30_000);
});
