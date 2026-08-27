/**
 * Staff affiliate invite links — create evergreen/one-time, public join auto-comps.
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
import { cleanupIntegrationTestAffiliates, cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `inv-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";
const affiliateIds: number[] = [];
const inviteIds: number[] = [];
const adminIds: number[] = [];

describe("affiliate invite links", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    // Ensure feature flag doesn't block (unset/1 enables)
    if (
      process.env.AFFILIATES_ENABLED === "0" ||
      process.env.AFFILIATES_ENABLED === "false"
    ) {
      process.env.AFFILIATES_ENABLED = "1";
    }
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No manager admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      "vitest-aff-invite",
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of inviteIds) {
      await pool.query(`DELETE FROM affiliate_invite_links WHERE id = ?`, [id]);
    }
    for (const id of affiliateIds) {
      await pool.query(`DELETE FROM affiliates WHERE id = ?`, [id]);
    }
    for (const id of adminIds) {
      await pool.query(`DELETE FROM admins WHERE id = ?`, [id]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
    });
    await cleanupIntegrationTestAffiliates(pool, {
      runId: RUN_ID,
      affiliateIds,
    });
    await pool?.end();
  }, 90_000);

  it("creates evergreen invite and joins with auto-comp", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        label: `Evergreen ${RUN_ID}`,
      })
      .expect(201);

    const link = create.body.link;
    expect(link.join_url).toContain("/affiliate/join/");
    expect(link.is_enabled).toBe(true);
    inviteIds.push(Number(link.id));

    const resolve = await request(app)
      .get(`/api/public/affiliate-invite/${link.token}`)
      .expect(200);
    expect(resolve.body.is_open).toBe(true);
    expect(resolve.body.plan).toBe("standard");
    expect(resolve.body.token).toBeUndefined();
    expect(resolve.body.slug).toBeNull();

    const email = `join-${RUN_ID}@example.test`;
    const join = await request(app)
      .post(`/api/public/affiliate-invite/${link.token}/join`)
      .send({
        first_name: "Join",
        last_name: RUN_ID,
        email,
        phone: "+15555550123",
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(201);

    expect(join.body.ok).toBe(true);
    expect(join.body.login_url).toContain("/admin/login");

    const [aff] = await pool.query<RowDataPacket[]>(
      `SELECT id, admin_id, status, subscription_status, plan, parent_affiliate_id
       FROM affiliates WHERE email = ? LIMIT 1`,
      [email],
    );
    expect(aff[0]).toBeTruthy();
    affiliateIds.push(Number(aff[0].id));
    adminIds.push(Number(aff[0].admin_id));
    expect(aff[0].status).toBe("active");
    expect(aff[0].subscription_status).toBe("comped");
    expect(aff[0].plan).toBe("standard");
    expect(aff[0].parent_affiliate_id).toBeNull();

    // Evergreen still open
    const again = await request(app)
      .get(`/api/public/affiliate-invite/${link.token}`)
      .expect(200);
    expect(again.body.is_open).toBe(true);
  }, 45_000);

  it("one-time invite closes after join; disable kills evergreen", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "one_time", plan: "standard", label: `Once ${RUN_ID}` })
      .expect(201);
    const link = create.body.link;
    inviteIds.push(Number(link.id));

    const email = `once-${RUN_ID}@example.test`;
    await request(app)
      .post(`/api/public/affiliate-invite/${link.token}/join`)
      .send({
        first_name: "Once",
        last_name: RUN_ID,
        email,
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(201);

    const [aff] = await pool.query<RowDataPacket[]>(
      `SELECT id, admin_id FROM affiliates WHERE email = ? LIMIT 1`,
      [email],
    );
    affiliateIds.push(Number(aff[0].id));
    adminIds.push(Number(aff[0].admin_id));

    const closed = await request(app)
      .get(`/api/public/affiliate-invite/${link.token}`)
      .expect(200);
    expect(closed.body.is_open).toBe(false);

    await request(app)
      .post(`/api/public/affiliate-invite/${link.token}/join`)
      .send({
        first_name: "Again",
        last_name: RUN_ID,
        email: `again-${RUN_ID}@example.test`,
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(410);

    // Kill switch on a fresh evergreen
    const evergreen = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "evergreen", plan: "standard", label: `Kill ${RUN_ID}` })
      .expect(201);
    inviteIds.push(Number(evergreen.body.link.id));

    await request(app)
      .patch(`/api/admin/affiliate-invite-links/${evergreen.body.link.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ is_enabled: false })
      .expect(200);

    const off = await request(app)
      .get(`/api/public/affiliate-invite/${evergreen.body.link.token}`)
      .expect(200);
    expect(off.body.is_open).toBe(false);
  }, 45_000);

  it("rejects master and sub_affiliate invite plans for now", async () => {
    await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "evergreen", plan: "master" })
      .expect(400);

    await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "sub_affiliate",
        parent_affiliate_id: 1,
      })
      .expect(400);
  }, 30_000);

  it("rejects invalid email and duplicate email without burning one-time uses twice", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "evergreen", plan: "standard", label: `Dup ${RUN_ID}` })
      .expect(201);
    inviteIds.push(Number(create.body.link.id));
    const token = create.body.link.token;

    await request(app)
      .post(`/api/public/affiliate-invite/${token}/join`)
      .send({
        first_name: "Bad",
        last_name: RUN_ID,
        email: "not-an-email",
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(400);

    const email = `dup-${RUN_ID}@example.test`;
    await request(app)
      .post(`/api/public/affiliate-invite/${token}/join`)
      .send({ first_name: "Dup", last_name: RUN_ID, email,
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(201);
    const [aff] = await pool.query<RowDataPacket[]>(
      `SELECT id, admin_id FROM affiliates WHERE email = ? LIMIT 1`,
      [email],
    );
    affiliateIds.push(Number(aff[0].id));
    adminIds.push(Number(aff[0].admin_id));

    const before = await pool.query<RowDataPacket[]>(
      `SELECT use_count FROM affiliate_invite_links WHERE id = ?`,
      [create.body.link.id],
    );
    const useBefore = Number(before[0][0].use_count);

    const dup = await request(app)
      .post(`/api/public/affiliate-invite/${token}/join`)
      .send({ first_name: "Dup2", last_name: RUN_ID, email,
        agreed_terms: true,
        agreed_sms: true,
      });
    expect([400, 409]).toContain(dup.status);

    // Claim+insert share a transaction — rollback restores use_count on dup email
    const after = await pool.query<RowDataPacket[]>(
      `SELECT use_count, is_enabled FROM affiliate_invite_links WHERE id = ?`,
      [create.body.link.id],
    );
    expect(Number(after[0][0].is_enabled)).toBe(1);
    expect(Number(after[0][0].use_count)).toBe(useBefore);
  }, 45_000);

  it("expired invite is closed", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        label: `Exp ${RUN_ID}`,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    inviteIds.push(Number(create.body.link.id));

    const resolve = await request(app)
      .get(`/api/public/affiliate-invite/${create.body.link.token}`)
      .expect(200);
    expect(resolve.body.is_open).toBe(false);

    await request(app)
      .post(`/api/public/affiliate-invite/${create.body.link.token}/join`)
      .send({
        first_name: "Exp",
        last_name: RUN_ID,
        email: `exp-${RUN_ID}@example.test`,
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(410);
  }, 30_000);

  it("custom slug resolves and delete removes the link", async () => {
    const slug = `invite-${RUN_ID}`.toLowerCase().slice(0, 64);
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        path_mode: "custom",
        slug,
        label: `Slug ${RUN_ID}`,
      })
      .expect(201);

    const link = create.body.link;
    expect(link.slug).toBe(slug);
    expect(link.join_url).toContain(`/affiliate/join/${slug}`);
    inviteIds.push(Number(link.id));

    const bySlug = await request(app)
      .get(`/api/public/affiliate-invite/${slug}`)
      .expect(200);
    expect(bySlug.body.is_open).toBe(true);
    expect(bySlug.body.slug).toBe(slug);
    expect(bySlug.body.token).toBeUndefined();

    // Token path still works after slug assigned
    const byToken = await request(app)
      .get(`/api/public/affiliate-invite/${link.token}`)
      .expect(200);
    expect(byToken.body.is_open).toBe(true);

    await request(app)
      .delete(`/api/admin/affiliate-invite-links/${link.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .get(`/api/public/affiliate-invite/${slug}`)
      .expect(404);

    // Already deleted — avoid double-delete in afterAll
    const idx = inviteIds.indexOf(Number(link.id));
    if (idx >= 0) inviteIds.splice(idx, 1);
  }, 45_000);

  it("joins via custom slug and rejects slug clashes", async () => {
    const slug = `join-slug-${RUN_ID}`.toLowerCase().slice(0, 64);
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        path_mode: "custom",
        slug,
        label: `JoinSlug ${RUN_ID}`,
      })
      .expect(201);
    inviteIds.push(Number(create.body.link.id));

    const email = `slug-join-${RUN_ID}@example.test`;
    const join = await request(app)
      .post(`/api/public/affiliate-invite/${slug}/join`)
      .send({ first_name: "Slug", last_name: RUN_ID, email,
        agreed_terms: true,
        agreed_sms: true,
      })
      .expect(201);
    expect(join.body.ok).toBe(true);

    const [aff] = await pool.query<RowDataPacket[]>(
      `SELECT id, admin_id, subscription_status FROM affiliates WHERE email = ? LIMIT 1`,
      [email],
    );
    affiliateIds.push(Number(aff[0].id));
    adminIds.push(Number(aff[0].admin_id));
    expect(aff[0].subscription_status).toBe("comped");

    await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        path_mode: "custom",
        slug,
      })
      .expect(409);
  }, 45_000);

  it("PATCH path modes: custom → token clears slug; auto remints", async () => {
    const slug = `patch-${RUN_ID}`.toLowerCase().slice(0, 64);
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        path_mode: "custom",
        slug,
        label: `Patch ${RUN_ID}`,
      })
      .expect(201);
    const id = Number(create.body.link.id);
    inviteIds.push(id);
    expect(create.body.link.slug).toBe(slug);

    const cleared = await request(app)
      .patch(`/api/admin/affiliate-invite-links/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ path_mode: "token" })
      .expect(200);
    expect(cleared.body.link.slug).toBeNull();
    expect(cleared.body.link.join_url).toContain(create.body.link.token);

    const auto = await request(app)
      .patch(`/api/admin/affiliate-invite-links/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ path_mode: "auto" })
      .expect(200);
    expect(auto.body.link.slug).toBeTruthy();
    expect(auto.body.link.join_url).toContain(`/affiliate/join/${auto.body.link.slug}`);

    // label-only update does not remint
    const sameSlug = auto.body.link.slug;
    const labeled = await request(app)
      .patch(`/api/admin/affiliate-invite-links/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: `Patched ${RUN_ID}` })
      .expect(200);
    expect(labeled.body.link.slug).toBe(sameSlug);
    expect(labeled.body.link.label).toBe(`Patched ${RUN_ID}`);
  }, 45_000);

  it("path_mode auto creates a name-based slug", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "one_time",
        plan: "standard",
        path_mode: "auto",
        label: `Auto ${RUN_ID}`,
      })
      .expect(201);
    inviteIds.push(Number(create.body.link.id));
    expect(create.body.link.slug).toBeTruthy();
    expect(create.body.link.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(create.body.link.join_url).toContain(
      `/affiliate/join/${create.body.link.slug}`,
    );
  }, 30_000);

  it("rejects join without terms consent", async () => {
    const create = await request(app)
      .post("/api/admin/affiliate-invite-links")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        kind: "evergreen",
        plan: "standard",
        label: `Consent ${RUN_ID}`,
      })
      .expect(201);
    inviteIds.push(Number(create.body.link.id));

    const denied = await request(app)
      .post(`/api/public/affiliate-invite/${create.body.link.token}/join`)
      .send({
        first_name: "No",
        last_name: RUN_ID,
        email: `noconsent-${RUN_ID}@example.test`,
      })
      .expect(400);
    expect(denied.body.code).toBe("CONSENT_REQUIRED");
  }, 30_000);
});
