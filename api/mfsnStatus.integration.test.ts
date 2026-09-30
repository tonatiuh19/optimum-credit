/**
 * Gated MFSN admin routes — default off, no vendor call on status GET.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `mfsn-${Date.now()}`;
const ADMIN_EMAIL = `mfsn-admin-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminId = 0;
let adminToken = "";

const prevEnv: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of [
    "MFSN_ENABLED",
    "MFSN_API_BASE_URL",
    "MFSN_API_EMAIL",
    "MFSN_API_PASSWORD",
    "MFSN_CLIENT_TOKEN",
  ]) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("admin MFSN gate", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    snapshotEnv();
    pool = createIntegrationTestPool();
    app = createServer();
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Mfsn', 'Probe', 'admin', 'active', 'en')`,
      [ADMIN_EMAIL],
    );
    adminId = Number(ins.insertId);
    adminToken = await createSession(
      "admin",
      adminId,
      ADMIN_EMAIL,
      "127.0.0.1",
      "vitest-mfsn",
    );
  }, 60_000);

  afterAll(async () => {
    restoreEnv();
    if (adminId) {
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
        adminId,
      ]);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [adminId]);
    }
    await pool?.end();
  }, 90_000);

  it("rejects unauthenticated status", async () => {
    await request(app).get("/api/admin/mfsn/status").expect(401);
  });

  it("returns disabled without calling vendor when flag is omitted", async () => {
    const res = await request(app)
      .get("/api/admin/mfsn/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.mode).toBe("disabled");
    expect(res.body.base_url).toBeNull();
    expect(res.body).not.toHaveProperty("token");
    expect(JSON.stringify(res.body)).not.toMatch(/"token"\s*:/);
  });

  it("probe-login is 501 while gated off", async () => {
    const res = await request(app)
      .post("/api/admin/mfsn/probe-login")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(501);
    expect(res.body.error).toBe("mfsn_disabled");
  });

  it("needs credentials when enabled without password", async () => {
    process.env.MFSN_ENABLED = "1";
    process.env.MFSN_API_EMAIL = "API#UserTest_29544";
    delete process.env.MFSN_API_PASSWORD;
    const status = await request(app)
      .get("/api/admin/mfsn/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(status.body.mode).toBe("needs_credentials");
    expect(status.body.base_url).toBe("https://uat-api.myfreescorenow.com");
    const probe = await request(app)
      .post("/api/admin/mfsn/probe-login")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(501);
    expect(probe.body.error).toBe("mfsn_needs_credentials");
    delete process.env.MFSN_ENABLED;
    delete process.env.MFSN_API_EMAIL;
  });
});
