/**
 * Multi-partner referrals + PUT referrer + CMS vault smoke.
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

const RUN_ID = `multi-ref-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let clientId = 0;
const referrerIds: number[] = [];

describe("multi-referrer + CMS credentials", () => {
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
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-multi-ref",
    );
  }, 60_000);

  afterAll(async () => {
    if (clientId) {
      await pool.query(`DELETE FROM client_referrers WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    for (const id of referrerIds) {
      await pool.query(`DELETE FROM referrers WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId],
    });
    await pool?.end();
  }, 90_000);

  it("creates two partners and edits email via PUT", async () => {
    for (const n of [1, 2]) {
      const res = await request(app)
        .post("/api/admin/referrers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          category: "realtor_broker",
          first_name: `Partner${n}`,
          last_name: RUN_ID,
          email: `p${n}-${RUN_ID}@example.test`,
          phone: `555010${n}`,
        });
      expect(res.status).toBe(201);
      referrerIds.push(Number(res.body.referrer.id));
    }
    const put = await request(app)
      .put(`/api/admin/referrers/${referrerIds[0]}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: `updated-${RUN_ID}@example.test` });
    expect(put.status).toBe(200);
    expect(put.body.referrer.email).toBe(`updated-${RUN_ID}@example.test`);
  }, 30_000);

  it("links up to 2 partners on a client and stores CMS vault", async () => {
    const create = await request(app)
      .post("/api/admin/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Multi",
        last_name: RUN_ID,
        email: `client-${RUN_ID}@example.test`,
        phone: "5550199",
        status: "prospect",
        referral_category: "realtor_broker",
        referrers: [
          { referrer_id: referrerIds[0] },
          { referrer_id: referrerIds[1] },
        ],
        cms_credentials: {
          smart_credit: {
            email: `sc-${RUN_ID}@example.test`,
            password: "fixture-sc-pw",
          },
          myfreescorenow: {
            email: `mfsn-${RUN_ID}@example.test`,
            password: "fixture-mfsn-pw",
          },
        },
      });
    expect(create.status).toBe(201);
    clientId = Number(create.body.client.id);

    const links = await request(app)
      .get(`/api/admin/clients/${clientId}/referrers`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(links.status).toBe(200);
    expect(links.body.referrers.length).toBe(2);

    const [mirror] = await pool.query<RowDataPacket[]>(
      `SELECT referrer_id FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(Number(mirror[0].referrer_id)).toBe(referrerIds[0]);

    const cms = await request(app)
      .get(
        `/api/admin/clients/${clientId}/cms-credentials?include_secrets=1&confirm_reveal=1`,
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cms.status).toBe(200);
    expect(cms.body.credentials.has_smart_credit_password).toBe(true);
    expect(cms.body.secrets.smart_credit.password).toBe("fixture-sc-pw");
    expect(cms.body.secrets.myfreescorenow.password).toBe("fixture-mfsn-pw");

    const cmsNoConfirm = await request(app)
      .get(`/api/admin/clients/${clientId}/cms-credentials?include_secrets=1`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cmsNoConfirm.status).toBe(400);
    expect(cmsNoConfirm.body.code).toBe("confirm_reveal_required");
  }, 45_000);

  it("rejects a 4th partner", async () => {
    for (let i = 0; i < 2; i++) {
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO referrers (category, first_name, last_name, email, phone)
         VALUES ('one_off', 'Extra${i}', ?, ?, ?)`,
        [RUN_ID, `extra${i}-${RUN_ID}@example.test`, `555011${i}`],
      );
      referrerIds.push(Number(ins.insertId));
    }
    expect(referrerIds.length).toBeGreaterThanOrEqual(4);
    const res = await request(app)
      .put(`/api/admin/clients/${clientId}/referrers`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        referrers: referrerIds.slice(0, 4).map((id) => ({ referrer_id: id })),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("too_many_referrers");
  }, 30_000);
});
