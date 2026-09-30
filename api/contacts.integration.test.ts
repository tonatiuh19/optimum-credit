/**
 * CRM Contacts — REST create / list / convert / soft-delete.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `crm-contact-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
let contactId = 0;
let convertedClientId = 0;
const extraContactIds: number[] = [];

describe("CRM contacts API", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [tables] = await pool.query<RowDataPacket[]>(
      `SHOW TABLES LIKE 'contacts'`,
    );
    if (!tables[0]) {
      throw new Error(
        "contacts table missing — apply 20260915_181500_crm_contacts.sql",
      );
    }

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
  }, 60_000);

  afterAll(async () => {
    if (convertedClientId > 0) {
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: [convertedClientId],
      });
    }
    const ids = [contactId, ...extraContactIds].filter((id) => id > 0);
    if (ids.length) {
      await pool.query(`DELETE FROM contacts WHERE id IN (?)`, [ids]);
    }
    await pool.query(
      `DELETE FROM contacts WHERE first_name = 'CrmContact' AND last_name LIKE ?`,
      [`%${RUN_ID.slice(-12)}%`],
    );
    await pool.end();
  });

  it("creates, lists, converts a contact to prospect", async () => {
    const phone = `765${String(Date.now()).slice(-7)}`;
    const last = RUN_ID.slice(-12);
    const create = await request(app)
      .post("/api/admin/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "CrmContact",
        last_name: last,
        phone,
        email: `${RUN_ID}@example.test`,
        preferred_language: "en",
        admin_notes: "integration test contact",
        confirm_duplicate: true,
      });
    expect(create.status).toBe(201);
    expect(create.body.contact?.id).toBeGreaterThan(0);
    contactId = Number(create.body.contact.id);

    const list = await request(app)
      .get("/api/admin/contacts")
      .query({ search: last, limit: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(
      (list.body.contacts || []).some((c: { id: number }) => c.id === contactId),
    ).toBe(true);

    const get = await request(app)
      .get(`/api/admin/contacts/${contactId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.contact.phone).toBe(`+1${phone}`);

    const convert = await request(app)
      .post(`/api/admin/contacts/${contactId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ confirm_duplicate: true });
    expect(convert.status).toBe(200);
    expect(convert.body.client_id).toBeGreaterThan(0);
    convertedClientId = Number(convert.body.client_id);

    const [clientRows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [convertedClientId],
    );
    expect(clientRows[0]?.status).toBe("prospect");
    expect(clientRows[0]?.pipeline_stage).toBe("prospect");

    const [archived] = await pool.query<RowDataPacket[]>(
      `SELECT converted_client_id, converted_at FROM contacts WHERE id = ? LIMIT 1`,
      [contactId],
    );
    expect(Number(archived[0]?.converted_client_id)).toBe(convertedClientId);
    expect(archived[0]?.converted_at).toBeTruthy();

    const listAfter = await request(app)
      .get("/api/admin/contacts")
      .query({ search: last, limit: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      (listAfter.body.contacts || []).some(
        (c: { id: number }) => c.id === contactId,
      ),
    ).toBe(false);
  }, 60_000);

  it("soft-deletes an active contact", async () => {
    const phone = `766${String(Date.now()).slice(-7)}`;
    const create = await request(app)
      .post("/api/admin/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "CrmContact",
        last_name: `Del${RUN_ID.slice(-8)}`,
        phone,
        preferred_language: "es",
        confirm_duplicate: true,
      });
    expect(create.status).toBe(201);
    const id = Number(create.body.contact.id);
    extraContactIds.push(id);

    const del = await request(app)
      .delete(`/api/admin/contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const get = await request(app)
      .get(`/api/admin/contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT deleted_at FROM contacts WHERE id = ? LIMIT 1`,
      [id],
    );
    expect(rows[0]?.deleted_at).toBeTruthy();
  }, 60_000);

  it("requires email or phone on create", async () => {
    const res = await request(app)
      .post("/api/admin/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "No",
        last_name: "Contact",
        preferred_language: "en",
      });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email and short phone on create", async () => {
    const badEmail = await request(app)
      .post("/api/admin/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Bad",
        last_name: `Email${RUN_ID.slice(-6)}`,
        email: "not-an-email",
        preferred_language: "en",
      });
    expect(badEmail.status).toBe(400);

    const badPhone = await request(app)
      .post("/api/admin/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Bad",
        last_name: `Phone${RUN_ID.slice(-6)}`,
        phone: "555-12",
        preferred_language: "en",
      });
    expect(badPhone.status).toBe(400);
  });
});
