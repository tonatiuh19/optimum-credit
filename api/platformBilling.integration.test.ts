/**
 * Billing routes: only the admins in BILLING_ADMIN_IDS (Alex, Cesar) see
 * Billing; other super admins get 403. Read-only against the real DB.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

let app: ReturnType<typeof createServer>;
let allowed = "";
let otherSuper = "";

describe("platform billing routes", () => {
  beforeAll(async () => {
    process.env.BILLING_ADMIN_IDS = "30001,90001";
    app = createServer();
    allowed = await createSession("admin", 30001, "billing-test@example.com", "127.0.0.1", "vitest-billing");
    const pool = createIntegrationTestPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admins WHERE role = 'super_admin' AND status = 'active' AND id NOT IN (30001, 90001) ORDER BY id LIMIT 1`,
    );
    await pool.end();
    otherSuper = await createSession("admin", Number(rows[0].id), "billing-test2@example.com", "127.0.0.1", "vitest-billing");
  }, 30_000);

  it("access flag: allowed vs other super admin", async () => {
    expect((await request(app).get("/api/admin/billing/access").set("Authorization", `Bearer ${allowed}`)).body).toEqual({ can_view_billing: true, is_owner: true });
    expect((await request(app).get("/api/admin/billing/access").set("Authorization", `Bearer ${otherSuper}`)).body).toEqual({ can_view_billing: false, is_owner: false });
  });

  it("other super admins are forbidden from every billing route", async () => {
    for (const path of ["/api/admin/billing/summary", "/api/admin/billing/prices", "/api/admin/billing/invoices"]) {
      expect((await request(app).get(path).set("Authorization", `Bearer ${otherSuper}`)).status).toBe(403);
    }
    expect((await request(app).get("/api/admin/billing/summary")).status).toBe(401);
  });

  it("summary + prices for an allowed admin", async () => {
    const s = await request(app).get("/api/admin/billing/summary?month=2026-10").set("Authorization", `Bearer ${allowed}`);
    expect(s.status).toBe(200);
    expect(s.body.month).toBe("2026-10");
    expect(Array.isArray(s.body.lines)).toBe(true);
    expect(s.body.usage).toHaveProperty("ai");
    expect(s.body.usage).not.toHaveProperty("twilio");
    const suite = s.body.plan.filter((p: any) => p.service === "suite");
    expect(suite).toHaveLength(6);
    expect(Math.round(suite.reduce((t: number, p: any) => t + p.unit_price_usd, 0) * 100)).toBe(58200);
    expect(s.body.plan).toEqual(expect.arrayContaining([{ action: "mcp_tool_call", service: "mcp", unit: "call", unit_price_usd: 0.01 }]));
    const p = await request(app).get("/api/admin/billing/prices").set("Authorization", `Bearer ${allowed}`);
    const suitePrices = p.body.prices.filter((x: any) => x.service === "suite");
    expect(suitePrices).toHaveLength(6);
    expect(suitePrices.every((x: any) => x.unit === "month" && x.billable)).toBe(true);
    expect(p.body.prices.find((x: any) => x.action === "mcp_tool_call")).toMatchObject({ billable: true });
  }, 30_000);

  it("Cesar (customer) sees plan + invoices, but not provider cost or the price editor", async () => {
    const cesar = await createSession("admin", 90001, "billing-test3@example.com", "127.0.0.1", "vitest-billing");
    const auth = { Authorization: `Bearer ${cesar}` };
    expect((await request(app).get("/api/admin/billing/access").set(auth)).body).toEqual({ can_view_billing: true, is_owner: false });
    const s = await request(app).get("/api/admin/billing/summary").set(auth);
    expect(s.status).toBe(200);
    expect(s.body.is_owner).toBe(false);
    expect(s.body.usage.ai).toEqual([]);
    expect(s.body.usage.ai_total_cost_usd).toBe(0);
    expect(s.body.plan.length).toBeGreaterThan(0);
    expect((await request(app).get("/api/admin/billing/prices").set(auth)).status).toBe(403);
    expect((await request(app).put("/api/admin/billing/prices/mcp_tool_call").set(auth).send({ unit_price_usd: 0 })).status).toBe(403);
    expect((await request(app).get("/api/admin/billing/invoices").set(auth)).status).toBe(200);
  }, 30_000);

  it("October: full base fee + every MCP call since Oct 1 (audit log), with projection", async () => {
    const s = await request(app).get("/api/admin/billing/summary?month=2026-10").set("Authorization", `Bearer ${allowed}`);
    const suite = s.body.lines.filter((l: any) => String(l.action).startsWith("suite_"));
    const mcp = s.body.lines.find((l: any) => l.action === "mcp_tool_call");
    expect(suite).toHaveLength(6);
    expect(suite.every((l: any) => l.billed_days === 31 && l.days_in_month === 31)).toBe(true);
    expect(Math.round(suite.reduce((t: number, l: any) => t + l.amount_usd, 0) * 100)).toBe(58200);
    expect(mcp.quantity).toBeGreaterThanOrEqual(14786);
    expect(s.body.total_usd).toBeCloseTo(582 + mcp.quantity * 0.01, 2);
    if (s.body.projection) expect(s.body.projection.total_usd).toBeGreaterThanOrEqual(s.body.total_usd);
  }, 60_000);

  it("platform details: live counts for billing admins only", async () => {
    const p = await request(app).get("/api/admin/billing/platform?month=2026-10").set("Authorization", `Bearer ${allowed}`);
    expect(p.status).toBe(200);
    expect(p.body.system.api_routes).toBeGreaterThan(100);
    expect(p.body.system.db_tables).toBeGreaterThan(50);
    expect(p.body.accounts.clients).toBeGreaterThan(0);
    expect(p.body.activity.mcp_calls).toBeGreaterThanOrEqual(14786);
    expect((await request(app).get("/api/admin/billing/platform").set("Authorization", `Bearer ${otherSuper}`)).status).toBe(403);
  }, 60_000);

  it("rejects invalid prices and unknown actions without writing", async () => {
    const bad = await request(app).put("/api/admin/billing/prices/mcp_tool_call").set("Authorization", `Bearer ${allowed}`).send({ unit_price_usd: -1 });
    expect(bad.status).toBe(400);
    const unknown = await request(app).put("/api/admin/billing/prices/nope").set("Authorization", `Bearer ${allowed}`).send({ unit_price_usd: 1 });
    expect(unknown.status).toBe(404);
  });

  it("payment method routes: gated, and no Stripe call when not configured", async () => {
    expect((await request(app).get("/api/admin/billing/payment-method").set("Authorization", `Bearer ${otherSuper}`)).status).toBe(403);
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const r = await request(app).get("/api/admin/billing/payment-method").set("Authorization", `Bearer ${allowed}`);
      expect(r.body).toMatchObject({ configured: false, payment_method: null });
      expect((await request(app).post("/api/admin/billing/setup-intent").set("Authorization", `Bearer ${allowed}`)).status).toBe(503);
      expect(
        (await request(app).post("/api/admin/billing/payment-method").set("Authorization", `Bearer ${allowed}`).send({ payment_method_id: "nope" })).status,
      ).toBe(400);
    } finally {
      if (saved) process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  it("Stripe webhook refuses unsigned events", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_vitest";
    expect((await request(app).post("/api/webhooks/stripe").send({ type: "invoice.paid" })).status).toBe(400);
  });

  it("payment-method hides a publishable key whose mode does not match the secret key", async () => {
    const savedSk = process.env.STRIPE_SECRET_KEY;
    const savedPk = process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.STRIPE_SECRET_KEY = "";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_mismatch";
    try {
      const r = await request(app).get("/api/admin/billing/payment-method").set("Authorization", `Bearer ${allowed}`);
      // No secret (sk not live) + live publishable → mode mismatch → not exposed.
      expect(r.body).toMatchObject({ configured: false, publishable_key: null });
    } finally {
      process.env.STRIPE_SECRET_KEY = savedSk;
      process.env.STRIPE_PUBLISHABLE_KEY = savedPk;
    }
  });
});
