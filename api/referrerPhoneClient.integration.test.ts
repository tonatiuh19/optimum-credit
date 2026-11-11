/**
 * GET /api/admin/clients/:id/referrers flags a referrer whose phone belongs to
 * another client, since an "Also send to" copy lands in that client's thread
 * (Nov 2026: a referrer copy showed up in an unrelated client's conversation).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN = `refphone${Date.now()}`;
const tail = String(Date.now()).slice(-7);
const SHARED_PHONE = `+1555${tail}`;
const OWN_PHONE = `+1556${tail}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
const clientIds: number[] = [];
const referrerIds: number[] = [];

async function addClient(first: string, phone: string | null) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, phone, status, pipeline_stage) VALUES (?, ?, ?, ?, 'active', 'round_1')`,
    [first, RUN, `${first.toLowerCase()}-${RUN}@example.test`, phone],
  );
  clientIds.push(r.insertId);
  return r.insertId;
}
async function addReferrer(first: string, phone: string, clientId: number, sort: number) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO referrers (category, first_name, last_name, phone) VALUES ('one_off', ?, ?, ?)`,
    [first, RUN, phone],
  );
  referrerIds.push(r.insertId);
  await pool.query(
    `INSERT INTO client_referrers (client_id, referrer_id, role, sort_order) VALUES (?, ?, ?, ?)`,
    [clientId, r.insertId, sort === 0 ? "primary" : "secondary", sort],
  );
}

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [admins] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.email FROM admins a
     JOIN admin_phone_numbers p ON p.assigned_admin_id = a.id AND p.is_active = 1
     WHERE a.status = 'active' ORDER BY a.id ASC LIMIT 1`,
  );
  token = await createSession("admin", Number(admins[0].id), String(admins[0].email), "127.0.0.1", "vitest-refphone");
}, 60_000);

afterAll(async () => {
  if (clientIds.length) await pool.query(`DELETE FROM client_referrers WHERE client_id IN (?)`, [clientIds]);
  if (referrerIds.length) await pool.query(`DELETE FROM referrers WHERE id IN (?)`, [referrerIds]);
  await cleanupIntegrationTestClients(pool, { runId: RUN, clientIds });
  await pool.end();
}, 60_000);

describe("referrer phone shared with another client", () => {
  it("names the other client for a shared phone and nothing for a unique one", async () => {
    const main = await addClient("Main", null);
    const other = await addClient("Other", SHARED_PHONE);
    await addReferrer("Shared", SHARED_PHONE, main, 0);
    await addReferrer("Unique", OWN_PHONE, main, 1);

    const res = await request(app)
      .get(`/api/admin/clients/${main}/referrers`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const byName = Object.fromEntries(
      res.body.referrers.map((l: any) => [l.referrer.first_name, l]),
    );
    expect(byName.Shared.phone_client).toEqual({ id: other, first_name: "Other", last_name: RUN });
    expect(byName.Unique.phone_client).toBeNull();
  });

  it("phone-owner names the client for a typed number, skips the client being texted, and rejects bad input", async () => {
    const [main, other] = clientIds;
    const owner = (body: Record<string, unknown>) =>
      request(app).post("/api/admin/conversations/phone-owner").set("Authorization", `Bearer ${token}`).send(body);

    const hit = await owner({ phone: SHARED_PHONE.replace("+1", ""), client_id: main }).expect(200);
    expect(hit.body.client).toEqual({ id: other, first_name: "Other", last_name: RUN });
    const formatted = await owner({ phone: `(${SHARED_PHONE.slice(2, 5)}) ${SHARED_PHONE.slice(5, 8)}-${SHARED_PHONE.slice(8)}` }).expect(200);
    expect(formatted.body.client?.id).toBe(other);
    expect((await owner({ phone: SHARED_PHONE, client_id: other }).expect(200)).body.client).toBeNull();
    expect((await owner({ phone: OWN_PHONE }).expect(200)).body.client).toBeNull();
    await owner({ phone: "123" }).expect(400);
    await request(app).post("/api/admin/conversations/phone-owner").send({ phone: SHARED_PHONE }).expect(401);
  });
});
