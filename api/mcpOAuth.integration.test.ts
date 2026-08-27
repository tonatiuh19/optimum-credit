/**
 * Remote MCP OAuth discovery + authorize redirect + token exchange (PKCE).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool, cleanupIntegrationTestMcpOAuth } from "./testDbCleanup";

const RUN_ID = `mcp-oauth-${Date.now()}`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let adminId = 0;
let prevFf: string | undefined;

function sha256b64url(verifier: string) {
  return crypto.createHash("sha256").update(verifier, "utf8").digest("base64url");
}

describe("MCP OAuth + remote endpoint", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevFf = process.env.ADMIN_AI_ENABLED;
    process.env.ADMIN_AI_ENABLED = "1";
    pool = createIntegrationTestPool();
    app = createServer();
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
    try {
      if (prevFf === undefined) delete process.env.ADMIN_AI_ENABLED;
      else process.env.ADMIN_AI_ENABLED = prevFf;
      // Scope OAuth junk to this run's vitest client_id prefixes only —
      // never wipe all codes/tokens for the shared prod admin.
      await cleanupIntegrationTestMcpOAuth(pool, { runId: RUN_ID });
    } catch (err) {
      console.error("[mcpOAuth] cleanup failed:", err);
    } finally {
      await pool?.end().catch(() => {});
    }
  });

  it("serves protected resource + AS metadata", async () => {
    const pr = await request(app).get("/.well-known/oauth-protected-resource");
    expect(pr.status).toBe(200);
    expect(pr.body.resource).toMatch(/\/api\/mcp$/);
    expect(pr.body.authorization_servers?.length).toBeGreaterThan(0);

    const as = await request(app).get(
      "/.well-known/oauth-authorization-server/api/mcp",
    );
    expect(as.status).toBe(200);
    expect(as.body.authorization_endpoint).toContain("/api/mcp/oauth/authorize");
    expect(as.body.code_challenge_methods_supported).toContain("S256");
  }, 20_000);

  it("PKCE authorize → approve → token → MCP tools/list", async () => {
    const clientId = `vitest-${RUN_ID}`;
    const redirectUri = "cursor://anysphere.cursor-mcp/oauth/callback";
    await pool.query(
      `INSERT INTO mcp_oauth_clients
         (client_id, client_name, redirect_uris_json, grant_types_json, token_endpoint_auth_method)
       VALUES (?, 'Vitest Cursor', ?, ?, 'none')`,
      [
        clientId,
        JSON.stringify([redirectUri]),
        JSON.stringify(["authorization_code", "refresh_token"]),
      ],
    );

    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = sha256b64url(verifier);

    const auth = await request(app)
      .get("/api/mcp/oauth/authorize")
      .query({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "st1",
      });
    expect(auth.status).toBe(302);
    expect(String(auth.headers.location)).toContain("/admin/mcp-consent");

    const approve = await request(app)
      .post("/api/mcp/oauth/approve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "st1",
        approve: true,
      });
    expect(approve.status).toBe(200);
    const redirectTo = String(approve.body.redirect_to || "");
    expect(redirectTo).toContain("code=");
    const code = new URL(redirectTo).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeTruthy();
    expect(tokenRes.body.refresh_token).toBeTruthy();

    const mcp = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      });
    expect(mcp.status).toBe(200);

    const list = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
    expect(list.status).toBe(200);
    const tools = (list.body?.result?.tools || []) as Array<{
      name: string;
      description?: string;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
      };
      inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
    }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("pipeline_summary");
    expect(names).toContain("search_clients");
    expect(names).toContain("search_referrers");
    expect(names).toContain("create_prospect");

    // Regression: MCP must advertise create_prospect fields (not the old
    // shared read-only stub: q/limit/case_id). Claude flagged this as
    // "schema mismatch" when first_name/phone were missing from the schema.
    const createProspect = tools.find((t) => t.name === "create_prospect");
    expect(createProspect?.inputSchema?.properties?.first_name).toBeTruthy();
    expect(createProspect?.inputSchema?.properties?.phone).toBeTruthy();
    expect(createProspect?.inputSchema?.properties?.preferred_language).toBeTruthy();
    expect(createProspect?.inputSchema?.required || []).toEqual(
      expect.arrayContaining(["first_name", "last_name", "phone", "preferred_language"]),
    );
    expect(createProspect?.inputSchema?.properties?.q).toBeUndefined();

    const createWorkTask = tools.find((t) => t.name === "create_work_task");
    expect(createWorkTask?.inputSchema?.properties?.preferred_language).toBeTruthy();
    expect(createWorkTask?.inputSchema?.properties?.push_hubspot).toBeTruthy();
    expect(createWorkTask?.description || "").toMatch(/OFG|push_hubspot/i);

    const convertProspect = tools.find((t) => t.name === "convert_prospect");
    expect(convertProspect).toBeTruthy();
    expect(convertProspect?.annotations?.readOnlyHint).toBe(true);
    expect(convertProspect?.annotations?.destructiveHint).toBe(false);
    expect(convertProspect?.annotations?.idempotentHint).toBe(false);
    expect(names).toContain("preview_convert_prospect");
    const previewConvert = tools.find((t) => t.name === "preview_convert_prospect");
    expect(previewConvert?.annotations?.readOnlyHint).toBe(true);
    expect(previewConvert?.annotations?.idempotentHint).toBe(true);
    expect(previewConvert?.inputSchema?.properties?.confirm).toBeUndefined();

    const sendEmailTool = tools.find((t) => t.name === "send_email");
    expect(sendEmailTool).toBeTruthy();
    expect(sendEmailTool?.annotations?.readOnlyHint).toBe(true);
    expect(sendEmailTool?.annotations?.idempotentHint).toBe(false);
    expect(sendEmailTool?.inputSchema?.properties?.subject).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.body).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.include_doc_upload_link).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.referrer_id).toBeTruthy();
    expect(names).toContain("search_referrers");

    const sendSmsTool = tools.find((t) => t.name === "send_sms");
    expect(sendSmsTool).toBeTruthy();
    expect(sendSmsTool?.annotations?.readOnlyHint).toBe(true);
    expect(sendSmsTool?.annotations?.idempotentHint).toBe(false);
    expect(sendSmsTool?.inputSchema?.properties?.body).toBeTruthy();
    expect(sendSmsTool?.inputSchema?.properties?.client_id).toBeTruthy();
    expect(sendSmsTool?.inputSchema?.properties?.referrer_id).toBeTruthy();
    expect(names).toContain("list_sms");
    const listSmsTool = tools.find((t) => t.name === "list_sms");
    expect(listSmsTool?.annotations?.readOnlyHint).toBe(true);
    expect(listSmsTool?.annotations?.idempotentHint).toBe(true);
    expect(names).toContain("send_text");
    expect(names).toContain("get_texts");
    expect(names).toContain("get_conversation");
    expect(names).toContain("list_ofg_phone_numbers");
    const sendTextTool = tools.find((t) => t.name === "send_text");
    expect(sendTextTool?.annotations?.readOnlyHint).toBe(true);
    expect(sendTextTool?.annotations?.idempotentHint).toBe(false);
    const listOfgTool = tools.find((t) => t.name === "list_ofg_phone_numbers");
    expect(listOfgTool?.annotations?.readOnlyHint).toBe(true);
    // tools/call dry-run create_prospect — end-to-end through MCP transport
    const phone = `555${String(Date.now()).slice(-7)}`;
    const call = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_prospect",
          arguments: {
            first_name: "McpCall",
            last_name: RUN_ID,
            phone,
            preferred_language: "en",
          },
        },
      });
    expect(call.status).toBe(200);
    const callText =
      call.body?.result?.content?.[0]?.text ||
      JSON.stringify(call.body?.result || call.body);
    expect(String(callText)).toMatch(/dry_run|ready|preview/i);
    expect(String(callText)).not.toMatch(/schema mismatch/i);
  }, 90_000);

  it("auto-registers Claude Desktop redirect without prior DCR", async () => {
    const clientId = `claude-vitest-${RUN_ID}`;
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = sha256b64url(verifier);

    const auth = await request(app)
      .get("/api/mcp/oauth/authorize")
      .query({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "claude-st",
      });
    expect(auth.status).toBe(302);
    expect(String(auth.headers.location)).toContain("/admin/mcp-consent");

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT client_id, redirect_uris_json FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1`,
      [clientId],
    );
    expect(rows[0]).toBeTruthy();
    const raw = rows[0].redirect_uris_json;
    const uris = Array.isArray(raw)
      ? raw.map(String)
      : JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
    expect(uris).toContain(redirectUri);
  }, 30_000);

  it("rejects insecure DCR redirect_uris and deny open-redirect", async () => {
    const badReg = await request(app)
      .post("/api/mcp/oauth/register")
      .send({
        client_name: "evil",
        redirect_uris: ["http://evil.example/callback"],
        token_endpoint_auth_method: "none",
      });
    expect(badReg.status).toBe(400);
    expect(badReg.body.error).toMatch(/redirect/i);

    const badHttps = await request(app)
      .post("/api/mcp/oauth/register")
      .send({
        client_name: "evil-https",
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      });
    expect(badHttps.status).toBe(400);

    const okReg = await request(app)
      .post("/api/mcp/oauth/register")
      .send({
        client_name: "claude-ok",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      });
    expect(okReg.status).toBe(201);
    expect(okReg.body.client_id).toBeTruthy();
    await pool.query(`DELETE FROM mcp_oauth_clients WHERE client_id = ?`, [
      okReg.body.client_id,
    ]);

    const clientId = `vitest-deny-${RUN_ID}`;
    const goodUri = "https://claude.ai/api/mcp/auth_callback";
    await pool.query(
      `INSERT INTO mcp_oauth_clients
         (client_id, client_name, redirect_uris_json, grant_types_json, token_endpoint_auth_method)
       VALUES (?, 'deny-test', ?, ?, 'none')`,
      [
        clientId,
        JSON.stringify([goodUri]),
        JSON.stringify(["authorization_code", "refresh_token"]),
      ],
    );

    const denyEvil = await request(app)
      .post("/api/mcp/oauth/approve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        client_id: clientId,
        redirect_uri: "https://evil.example/steal",
        code_challenge: "x".repeat(43),
        approve: false,
        state: "st",
      });
    expect(denyEvil.status).toBe(400);
    expect(denyEvil.body.error).toBe("invalid_redirect_uri");
  }, 30_000);
});
