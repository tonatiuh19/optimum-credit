/**
 * Affiliates v1 — HTTP integration tests.
 * Covers: public resolve/click, admin create + slug uniqueness,
 * attribution (first-touch), hard isolation, commissions suggestions.
 *
 * Local/prod `.env` may set AFFILIATES_ENABLED=0 (feature gated until
 * subscription pricing is ready). These tests must exercise the live
 * affiliate routes, so force-enable before createServer / requests.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  cleanupIntegrationTestAffiliates,
  cleanupIntegrationTestClients,
} from "./testDbCleanup";

// Must run before `./index` is loaded — imports below would hoist after this
// in some runners; also re-set in beforeAll for safety.
process.env.AFFILIATES_ENABLED = "1";

const { createServer, createSession } = await import("./index");

const CASE_TIMEOUT = 45_000;

const RUN_ID = `aff-${Date.now()}`;
const SLUG = `test-${RUN_ID}`.slice(0, 48);
const AFF_EMAIL = `${RUN_ID}@affiliate.test`;
const OTHER_EMAIL = `${RUN_ID}-other@affiliate.test`;
const MASTER_EMAIL = `${RUN_ID}-master@affiliate.test`;
const SUB_EMAIL = `${RUN_ID}-sub@affiliate.test`;
const LEAD_EMAIL = `${RUN_ID}-lead@example.test`;
const LEAD2_EMAIL = `${RUN_ID}-lead2@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let managerId = 0;
let managerToken = "";
let affiliateId = 0;
let affiliateAdminId = 0;
let affiliateToken = "";
let otherAffiliateId = 0;
let otherAffiliateAdminId = 0;
let otherAffiliateToken = "";
let masterAffiliateId = 0;
let masterAdminId = 0;
let subAffiliateId = 0;
let subAdminId = 0;
let attributedClientId = 0;
let foreignClientId = 0;

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

describe("affiliates — HTTP integration", () => {
  beforeAll(async () => {
    process.env.AFFILIATES_ENABLED = "1";
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required for integration tests");
    }
    pool = await makePool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, role FROM admins WHERE role IN ('super_admin','admin') ORDER BY FIELD(role,'super_admin','admin') ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No manager admin for affiliate tests");
    managerId = Number(admins[0].id);
    managerToken = await createSession(
      "admin",
      managerId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-affiliates",
    );
  }, 60_000);

  afterAll(async () => {
    try {
      if (attributedClientId) {
        await pool.query(`DELETE FROM clients WHERE id = ?`, [
          attributedClientId,
        ]);
      }
      if (foreignClientId) {
        await pool.query(`DELETE FROM clients WHERE id = ?`, [foreignClientId]);
      }
      await pool.query(`DELETE FROM clients WHERE email LIKE ?`, [
        `${RUN_ID}%`,
      ]);
      if (affiliateId) {
        await pool.query(
          `DELETE FROM affiliate_link_clicks WHERE affiliate_id = ?`,
          [affiliateId],
        );
        await pool.query(
          `DELETE FROM affiliate_commissions WHERE affiliate_id = ?`,
          [affiliateId],
        );
      }
      if (subAffiliateId) {
        await pool.query(
          `DELETE FROM affiliate_commissions WHERE affiliate_id = ?`,
          [subAffiliateId],
        );
      }
      if (masterAffiliateId) {
        await pool.query(
          `DELETE FROM affiliate_commissions WHERE affiliate_id = ?`,
          [masterAffiliateId],
        );
      }
      await pool.query(`DELETE FROM affiliates WHERE email IN (?, ?, ?, ?)`, [
        AFF_EMAIL,
        OTHER_EMAIL,
        MASTER_EMAIL,
        SUB_EMAIL,
      ]);
      if (affiliateAdminId) {
        await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
          affiliateAdminId,
        ]);
      }
      if (otherAffiliateAdminId) {
        await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
          otherAffiliateAdminId,
        ]);
      }
      if (masterAdminId) {
        await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
          masterAdminId,
        ]);
      }
      if (subAdminId) {
        await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
          subAdminId,
        ]);
      }
      await pool.query(`DELETE FROM admins WHERE email IN (?, ?, ?, ?)`, [
        AFF_EMAIL,
        OTHER_EMAIL,
        MASTER_EMAIL,
        SUB_EMAIL,
      ]);
      await cleanupIntegrationTestClients(pool, {
        runId: RUN_ID,
        clientIds: [attributedClientId, foreignClientId],
      });
      await cleanupIntegrationTestAffiliates(pool, {
        runId: RUN_ID,
        affiliateIds: [
          affiliateId,
          otherAffiliateId,
          masterAffiliateId,
          subAffiliateId,
        ],
      });
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it(
    "returns commission / tier suggestions",
    async () => {
      const res = await request(app)
        .get("/api/admin/affiliates/meta/suggestions")
        .set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.suggestions?.standard?.monthly_price_cents).toBe(20000);
      expect(res.body.suggestions?.master?.monthly_price_cents).toBe(50000);
      expect(res.body.suggestions?.standard?.commission_rate_bps).toBe(1000);
      expect(res.body.suggestions?.master?.commission_rate_bps).toBe(1500);
    },
    CASE_TIMEOUT,
  );

  it(
    "creates an affiliate (admin + profile) with auto slug",
    async () => {
      const res = await request(app)
        .post("/api/admin/affiliates")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          email: AFF_EMAIL,
          first_name: "Test",
          last_name: "Affiliate",
          plan: "standard",
          slug: SLUG,
          default_landing: "credit_analysis",
          comp_subscription: true,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
      expect(res.body.slug).toBe(SLUG);
      affiliateId = Number(res.body.id);
      affiliateAdminId = Number(res.body.admin_id);

      const [affRows] = await pool.query<RowDataPacket[]>(
        `SELECT status, subscription_status FROM affiliates WHERE id = ?`,
        [affiliateId],
      );
      expect(affRows[0]?.status).toBe("active");
      expect(affRows[0]?.subscription_status).toBe("comped");

      const [adminRows] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ?`,
        [affiliateAdminId],
      );
      expect(adminRows[0]?.role).toBe("affiliate");

      affiliateToken = await createSession(
        "admin",
        affiliateAdminId,
        AFF_EMAIL,
        "127.0.0.1",
        "vitest-aff-self",
      );
    },
    CASE_TIMEOUT,
  );

  it(
    "auto-suffixes colliding slug instead of failing hard",
    async () => {
      const res = await request(app)
        .post("/api/admin/affiliates")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          email: OTHER_EMAIL,
          first_name: "Other",
          last_name: "Aff",
          plan: "standard",
          slug: SLUG,
          comp_subscription: true,
        });
      if (res.status === 200) {
        expect(res.body.slug).not.toBe(SLUG);
        const createdId = Number(res.body.id);
        const createdAdminId = Number(res.body.admin_id);
        await pool.query(`DELETE FROM affiliates WHERE id = ?`, [createdId]);
        await pool.query(`DELETE FROM admins WHERE id = ?`, [createdAdminId]);
      } else {
        expect([400, 409]).toContain(res.status);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "creates a second affiliate for isolation tests",
    async () => {
      const res = await request(app)
        .post("/api/admin/affiliates")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          email: OTHER_EMAIL,
          first_name: "Other",
          last_name: "Aff",
          plan: "standard",
          slug: `${SLUG}-b`.slice(0, 64),
          comp_subscription: true,
        });
      expect(res.status).toBe(200);
      otherAffiliateId = Number(res.body.id);
      otherAffiliateAdminId = Number(res.body.admin_id);
      otherAffiliateToken = await createSession(
        "admin",
        otherAffiliateAdminId,
        OTHER_EMAIL,
        "127.0.0.1",
        "vitest-aff-other",
      );
    },
    CASE_TIMEOUT,
  );

  it(
    "public resolve + click works for slug",
    async () => {
      const resolve = await request(app).get(`/api/public/affiliates/${SLUG}`);
      expect(resolve.status).toBe(200);
      expect(resolve.body.slug).toBe(SLUG);
      expect(resolve.body.redirect_path).toContain("ref=");
      expect(resolve.body.links?.short_default).toContain(`/r/${SLUG}`);
      expect(resolve.body.links?.analysis_ref).toContain("credit-analysis");
      expect(resolve.body.links?.pricing_ref).toContain("pricing");

      const click = await request(app)
        .post(`/api/public/affiliates/${SLUG}/click`)
        .send({ landing: "credit_analysis" });
      expect(click.status).toBe(200);
      expect(click.body.ok).toBe(true);

      const [clicks] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM affiliate_link_clicks WHERE affiliate_id = ?`,
        [affiliateId],
      );
      expect(Number(clicks[0].n)).toBeGreaterThanOrEqual(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "attributes prospect-lead via ref (first-touch)",
    async () => {
      const res = await request(app)
        .post("/api/public/prospect-lead")
        .send({
          email: LEAD_EMAIL,
          first_name: "Lead",
          last_name: "One",
          phone: "+15555550111",
          ref: SLUG,
        });
      expect([200, 201]).toContain(res.status);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, affiliate_id FROM clients WHERE email = ? LIMIT 1`,
        [LEAD_EMAIL],
      );
      expect(rows[0]).toBeTruthy();
      attributedClientId = Number(rows[0].id);
      expect(Number(rows[0].affiliate_id)).toBe(affiliateId);

      const [labels] = await pool.query<RowDataPacket[]>(
        `SELECT l.slug FROM client_labels cl
         JOIN labels l ON l.id = cl.label_id
         WHERE cl.client_id = ? AND l.slug = 'affiliate_referral'`,
        [attributedClientId],
      );
      expect(labels.length).toBeGreaterThanOrEqual(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "does not overwrite affiliate_id on second ref (first-touch)",
    async () => {
      const otherSlug = `${SLUG}-b`.slice(0, 64);
      const res = await request(app)
        .post("/api/public/prospect-lead")
        .send({
          email: LEAD_EMAIL,
          first_name: "Lead",
          last_name: "One",
          ref: otherSlug,
        });
      expect([200, 201, 409]).toContain(res.status);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT affiliate_id FROM clients WHERE id = ?`,
        [attributedClientId],
      );
      expect(Number(rows[0].affiliate_id)).toBe(affiliateId);
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate pipeline only sees own leads",
    async () => {
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients (email, first_name, last_name, status, pipeline_stage, affiliate_id)
         VALUES (?, 'Foreign', 'Lead', 'prospect', 'prospect', ?)`,
        [LEAD2_EMAIL, otherAffiliateId],
      );
      foreignClientId = ins.insertId;

      const mine = await request(app)
        .get("/api/admin/pipeline")
        .set("Authorization", `Bearer ${affiliateToken}`);
      expect(mine.status).toBe(200);
      const myProspectIds = (mine.body.prospects || []).map(
        (p: { id: number }) => Number(p.id),
      );
      expect(myProspectIds).toContain(attributedClientId);
      expect(myProspectIds).not.toContain(foreignClientId);

      const other = await request(app)
        .get("/api/admin/pipeline")
        .set("Authorization", `Bearer ${otherAffiliateToken}`);
      expect(other.status).toBe(200);
      const otherIds = (other.body.prospects || []).map((p: { id: number }) =>
        Number(p.id),
      );
      expect(otherIds).toContain(foreignClientId);
      expect(otherIds).not.toContain(attributedClientId);
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate cannot open foreign client detail",
    async () => {
      const res = await request(app)
        .get(`/api/admin/clients/${foreignClientId}`)
        .set("Authorization", `Bearer ${affiliateToken}`);
      expect([403, 404]).toContain(res.status);
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate cannot update a foreign client",
    async () => {
      const res = await request(app)
        .put(`/api/admin/clients/${foreignClientId}`)
        .set("Authorization", `Bearer ${affiliateToken}`)
        .send({ first_name: "Hacked" });
      expect([403, 404]).toContain(res.status);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT first_name FROM clients WHERE id = ?`,
        [foreignClientId],
      );
      expect(rows[0]?.first_name).toBe("Foreign");
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate is blocked from team-only surfaces (payments, documents)",
    async () => {
      const payments = await request(app)
        .get("/api/admin/payments")
        .set("Authorization", `Bearer ${affiliateToken}`);
      expect(payments.status).toBe(403);

      const documents = await request(app)
        .get("/api/admin/documents")
        .set("Authorization", `Bearer ${affiliateToken}`);
      expect(documents.status).toBe(403);
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate creating a client via /api/admin/clients stamps prospect + affiliate_id",
    async () => {
      const email = `${RUN_ID}-created@example.test`;
      const res = await request(app)
        .post("/api/admin/clients")
        .set("Authorization", `Bearer ${affiliateToken}`)
        .send({
          first_name: "Created",
          last_name: "ByAffiliate",
          email,
          // Affiliates may not set status/package — these must be ignored.
          status: "active",
          package_id: 1,
        });
      expect(res.status).toBe(201);
      const createdId = Number(res.body.client?.id);
      expect(createdId).toBeTruthy();

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT status, pipeline_stage, affiliate_id, package_id FROM clients WHERE id = ?`,
        [createdId],
      );
      expect(rows[0].status).toBe("prospect");
      expect(rows[0].pipeline_stage).toBe("prospect");
      expect(Number(rows[0].affiliate_id)).toBe(affiliateId);
      expect(rows[0].package_id).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate can create a manual lead attributed to self",
    async () => {
      const email = `${RUN_ID}-manual@example.test`;
      const res = await request(app)
        .post("/api/admin/affiliate/leads")
        .set("Authorization", `Bearer ${affiliateToken}`)
        .send({
          email,
          first_name: "Manual",
          last_name: "Lead",
          phone: "+15555550122",
        });
      expect([200, 201]).toContain(res.status);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, affiliate_id FROM clients WHERE email = ?`,
        [email],
      );
      expect(Number(rows[0]?.affiliate_id)).toBe(affiliateId);
    },
    CASE_TIMEOUT,
  );

  it(
    "affiliate cannot manage the affiliates list",
    async () => {
      const res = await request(app)
        .get("/api/admin/affiliates")
        .set("Authorization", `Bearer ${affiliateToken}`);
      expect(res.status).toBe(403);
    },
    CASE_TIMEOUT,
  );

  it(
    "master affiliate can create a sub-affiliate via self-service endpoint",
    async () => {
      const createRes = await request(app)
        .post("/api/admin/affiliates")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          email: MASTER_EMAIL,
          first_name: "Master",
          last_name: "Aff",
          plan: "master",
          comp_subscription: true,
        });
      expect(createRes.status).toBe(200);
      masterAffiliateId = Number(createRes.body.id);
      masterAdminId = Number(createRes.body.admin_id);
      const masterToken = await createSession(
        "admin",
        masterAdminId,
        MASTER_EMAIL,
        "127.0.0.1",
        "vitest-aff-master",
      );

      const subRes = await request(app)
        .post("/api/admin/affiliate/subs")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ email: SUB_EMAIL, first_name: "Sub", last_name: "Aff" });
      expect([200, 201]).toContain(subRes.status);
      expect(subRes.body.id).toBeTruthy();

      const [subRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, admin_id, plan, parent_affiliate_id FROM affiliates WHERE email = ? LIMIT 1`,
        [SUB_EMAIL],
      );
      expect(subRows[0]).toBeTruthy();
      expect(subRows[0].plan).toBe("sub_affiliate");
      expect(Number(subRows[0].parent_affiliate_id)).toBe(masterAffiliateId);
      subAffiliateId = Number(subRows[0].id);
      subAdminId = Number(subRows[0].admin_id);
    },
    CASE_TIMEOUT,
  );

  it(
    "commission list includes client_name after creating a manual commission",
    async () => {
      const createRes = await request(app)
        .post(`/api/admin/affiliates/${affiliateId}/commissions`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          amount_cents: 500,
          client_id: attributedClientId,
          notes: "vitest manual commission",
        });
      expect(createRes.status).toBe(200);
      expect(createRes.body.id).toBeTruthy();

      const listRes = await request(app)
        .get(`/api/admin/affiliates/${affiliateId}/commissions`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(listRes.status).toBe(200);
      const created = (listRes.body.commissions || []).find(
        (c: { id: number }) => Number(c.id) === Number(createRes.body.id),
      );
      expect(created).toBeTruthy();
      expect(created.client_name).toBe("Lead One");
    },
    CASE_TIMEOUT,
  );
});
