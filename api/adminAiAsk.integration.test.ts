/**
 * Admin AI Ask — feature flag, role gate, missing key (no live Anthropic calls).
 * Uses an ephemeral agent for the role-gate assertion so parallel suites that
 * create/delete `@example.test` agents cannot turn a 403 into a 401.
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
import { createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `admin-ai-${Date.now()}`;
const AGENT_EMAIL = `ai-ask-agent-${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let adminId = 0;
let agentToken = "";
let agentId = 0;
let prevFf: string | undefined;
let prevKey: string | undefined;

describe("admin AI Ask", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevFf = process.env.ADMIN_AI_ENABLED;
    prevKey = process.env.ANTHROPIC_API_KEY;
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, role FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
         AND email NOT LIKE '%@example.test'
       ORDER BY FIELD(role,'super_admin','admin'), id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No super_admin/admin");
    adminId = Number(admins[0].id);
    adminToken = await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      `vitest-${RUN_ID}-admin`,
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Ask', 'Agent', 'agent', 'active', 'en')`,
      [AGENT_EMAIL],
    );
    agentId = Number(ins.insertId);
    agentToken = await createSession(
      "admin",
      agentId,
      AGENT_EMAIL,
      "127.0.0.1",
      `vitest-${RUN_ID}-agent`,
    );
  }, 60_000);

  afterAll(async () => {
    if (prevFf === undefined) delete process.env.ADMIN_AI_ENABLED;
    else process.env.ADMIN_AI_ENABLED = prevFf;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (agentId) {
      await pool.query(`DELETE FROM admin_ai_audit_logs WHERE admin_id = ?`, [
        agentId,
      ]);
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [
        agentId,
      ]);
      await pool.query(`DELETE FROM admins WHERE id = ?`, [agentId]);
    }
    await pool?.end();
  });

  it("returns 404 when feature flag is off", async () => {
    process.env.ADMIN_AI_ENABLED = "0";
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app)
      .post("/api/admin/ai/chat")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(404);
  }, 30_000);

  it("status.enabled is false when flag off", async () => {
    process.env.ADMIN_AI_ENABLED = "0";
    const res = await request(app)
      .get("/api/admin/ai/status")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  }, 15_000);

  it("me.ai_ask_enabled follows the flag for staff admins", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const on = await request(app)
      .get("/api/auth/admin/me")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(on.status).toBe(200);
    expect(on.body.user.ai_ask_enabled).toBe(true);

    process.env.ADMIN_AI_ENABLED = "0";
    const off = await request(app)
      .get("/api/auth/admin/me")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(off.status).toBe(200);
    expect(off.body.user.ai_ask_enabled).toBe(false);
  }, 30_000);

  it("returns 503 when enabled but API key missing", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app)
      .post("/api/admin/ai/chat")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ messages: [{ role: "user", content: "What is Docs Ready?" }] });
    expect(res.status).toBe(503);
    expect(String(res.body.error || "")).toMatch(/contact support/i);
    expect(String(res.body.error || "")).not.toMatch(/ANTHROPIC/i);
  }, 30_000);

  it("rejects agent role with 403", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app)
      .post("/api/admin/ai/chat")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(403);
    expect(String(res.body.error || "")).toMatch(/super_admin and admin/i);
  }, 30_000);

  it("requires auth", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const res = await request(app)
      .post("/api/admin/ai/chat")
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(401);
  }, 15_000);

  it("lists curated tools when enabled", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const res = await request(app)
      .get("/api/admin/ai/tools")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.tools || []).map((t: { name: string }) => t.name);
    expect(names).toContain("search_clients");
    expect(names).toContain("search_referrers");
    expect(names).toContain("pipeline_summary");
    expect(names).toContain("get_case");
    expect(names).toContain("list_clients_owing");
    expect(names).toContain("list_installments");
    expect(names).toContain("list_payments");
    expect(names).toContain("get_client");
    expect(names).toContain("list_case_documents");
    expect(names).toContain("list_round_schedule");
    expect(names).toContain("create_prospect");
    expect(names).toContain("create_work_task");
    expect(names).toContain("search_admins");
    expect(names).toContain("add_case_note");
    expect(names).toContain("upload_case_document");
    expect(names).toContain("send_email");
    expect(names).toContain("send_round_report");
    expect(names).toContain("send_sms");
    expect(names).toContain("list_sms");
    expect(names).toContain("update_pipeline_stage");
    expect(names).toContain("preview_convert_prospect");
    expect(names).toContain("convert_prospect");
    expect(names).toContain("upsert_progress_report");
    expect(names).toContain("upsert_payment_splits");
    expect(names).toContain("update_payment_split");
    expect(names).toContain("set_case_payment_plan");
    expect(names).toContain("list_coupons");
    expect(names).toContain("create_coupon");
    expect(names).toContain("list_funding_applications");
    expect(names).toContain("get_funding_application");
    expect(names).toContain("funding_pipeline_summary");
    expect(names).toContain("create_funding_application");
    expect(names).toContain("convert_funding_application");
    expect(names).toContain("upload_funding_document");
    expect(names).toContain("update_funding_status");
  }, 30_000);

  it("executes pipeline_summary via tools API", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const res = await request(app)
      .post("/api/admin/ai/tools/pipeline_summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tool).toBe("pipeline_summary");
    expect(res.body.data).toBeTruthy();
  }, 45_000);

  it("accepts ADMIN_AI_MCP_TOKEN for tools list", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const mcpToken = `vitest-mcp-${RUN_ID}`;
    const prevTok = process.env.ADMIN_AI_MCP_TOKEN;
    const prevId = process.env.ADMIN_AI_MCP_ADMIN_ID;
    process.env.ADMIN_AI_MCP_TOKEN = mcpToken;
    process.env.ADMIN_AI_MCP_ADMIN_ID = String(adminId);
    try {
      const res = await request(app)
        .get("/api/admin/ai/tools")
        .set("Authorization", `Bearer ${mcpToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tools)).toBe(true);
      expect(res.body.tools.length).toBeGreaterThan(0);
    } finally {
      if (prevTok === undefined) delete process.env.ADMIN_AI_MCP_TOKEN;
      else process.env.ADMIN_AI_MCP_TOKEN = prevTok;
      if (prevId === undefined) delete process.env.ADMIN_AI_MCP_ADMIN_ID;
      else process.env.ADMIN_AI_MCP_ADMIN_ID = prevId;
    }
  }, 30_000);

  it("rejects unknown tool name", async () => {
    process.env.ADMIN_AI_ENABLED = "1";
    const res = await request(app)
      .post("/api/admin/ai/tools/drop_all_tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("unknown_tool");
  }, 15_000);
});
