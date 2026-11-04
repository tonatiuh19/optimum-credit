/**
 * Remote MCP OAuth discovery + authorize redirect + token exchange (PKCE).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import {
  MCP_OAUTH_TOKEN_RATE,
  adminAiMcpHourlyLimit,
  createServer,
  createSession,
  hitRateLimit,
} from "./index";
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
    expect(createWorkTask?.inputSchema?.properties?.assignee_name).toBeTruthy();
    expect(createWorkTask?.inputSchema?.properties?.push_hubspot).toBeTruthy();
    expect(createWorkTask?.description || "").toMatch(/OFG|push_hubspot/i);
    expect(names).toContain("search_admins");
    expect(names).toContain("update_work_task");
    const updateWorkTask = tools.find((t) => t.name === "update_work_task");
    expect(updateWorkTask?.inputSchema?.properties?.task_id).toBeTruthy();
    expect(updateWorkTask?.inputSchema?.properties?.assignee_name).toBeTruthy();
    expect(createProspect?.inputSchema?.properties?.assigned_admin_name).toBeTruthy();

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
    // Sends ask the user (Oct 27, 2026) — destructive, not read-only
    expect(sendEmailTool?.annotations?.readOnlyHint).toBe(false);
    expect(sendEmailTool?.annotations?.destructiveHint).toBe(true);
    expect(sendEmailTool?.annotations?.idempotentHint).toBe(false);
    expect(sendEmailTool?.inputSchema?.properties?.subject).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.body).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.include_doc_upload_link).toBeTruthy();
    expect(sendEmailTool?.inputSchema?.properties?.referrer_id).toBeTruthy();
    expect(names).toContain("search_referrers");

    const sendSmsTool = tools.find((t) => t.name === "send_sms");
    expect(sendSmsTool).toBeTruthy();
    // Sends ask the user (Oct 27, 2026) — destructive, not read-only
    expect(sendSmsTool?.annotations?.readOnlyHint).toBe(false);
    expect(sendSmsTool?.annotations?.destructiveHint).toBe(true);
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
    expect(sendTextTool?.annotations?.readOnlyHint).toBe(false);
    expect(sendTextTool?.annotations?.destructiveHint).toBe(true);
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

  // ── Hardening (Oct 27, 2026): 401 challenge, refresh rotation, revoke,
  //    send-tool annotations + instructions, audit redaction, rate limits.
  //    Rate-limit tests run last: they exhaust in-memory buckets for this file.

  async function issueTokens(suffix: string) {
    const clientId = `vitest-${RUN_ID}-${suffix}`;
    const redirectUri = "cursor://anysphere.cursor-mcp/oauth/callback";
    await pool.query(
      `INSERT INTO mcp_oauth_clients
         (client_id, client_name, redirect_uris_json, grant_types_json, token_endpoint_auth_method)
       VALUES (?, 'Vitest hardening', ?, ?, 'none')`,
      [clientId, JSON.stringify([redirectUri]), JSON.stringify(["authorization_code", "refresh_token"])],
    );
    const verifier = crypto.randomBytes(32).toString("base64url");
    const approve = await request(app)
      .post("/api/mcp/oauth/approve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ client_id: clientId, redirect_uri: redirectUri, code_challenge: sha256b64url(verifier), approve: true });
    expect(approve.status).toBe(200);
    const code = new URL(String(approve.body.redirect_to)).searchParams.get("code");
    const tok = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier });
    expect(tok.status).toBe(200);
    return { clientId, access: String(tok.body.access_token), refresh: String(tok.body.refresh_token) };
  }

  const mcpCall = (access: string, method: string, params: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${access}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method, params });

  const refreshWith = (clientId: string, refresh: string) =>
    request(app).post("/api/mcp/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh });

  it("401 challenge carries resource_metadata (RFC 9728)", async () => {
    for (const auth of [undefined, "Bearer not-a-real-token"]) {
      const r = request(app).post("/api/mcp").send({});
      const res = await (auth ? r.set("Authorization", auth) : r);
      expect(res.status).toBe(401);
      expect(String(res.headers["www-authenticate"])).toMatch(
        /^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource", scope="admin_ai\.read"$/,
      );
    }
  }, 30_000);

  it("refresh rotates both tokens; the old pair stops working", async () => {
    const t = await issueTokens("rot");
    const r1 = await refreshWith(t.clientId, t.refresh);
    expect(r1.status).toBe(200);
    expect(r1.body.access_token).not.toBe(t.access);
    expect(r1.body.refresh_token).not.toBe(t.refresh);

    expect((await refreshWith(t.clientId, t.refresh)).body.error).toBe("invalid_grant");
    expect((await mcpCall(t.access, "tools/list")).status).toBe(401);
    expect((await mcpCall(r1.body.access_token, "tools/list")).status).toBe(200);

    // A refresh token is bound to its client
    expect((await refreshWith(`vitest-${RUN_ID}-other`, r1.body.refresh_token)).status).toBe(400);
  }, 60_000);

  it("revoke kills access and refresh; revoking twice is harmless", async () => {
    const t = await issueTokens("rev");
    expect((await mcpCall(t.access, "tools/list")).status).toBe(200);
    const rv = await request(app).post("/api/mcp/oauth/revoke").type("form").send({ token: t.refresh });
    expect(rv.status).toBe(200);
    expect((await mcpCall(t.access, "tools/list")).status).toBe(401);
    expect((await refreshWith(t.clientId, t.refresh)).body.error).toBe("invalid_grant");
    expect((await request(app).post("/api/mcp/oauth/revoke").type("form").send({ token: t.refresh })).status).toBe(200);
    expect((await request(app).post("/api/mcp/oauth/revoke").type("form").send({})).status).toBe(200);
  }, 60_000);

  it("send tools are destructive (client asks the user); server sends instructions", async () => {
    const t = await issueTokens("ann");
    const init = await mcpCall(t.access, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    expect(String(init.body?.result?.instructions || "")).toMatch(/untrusted/i);

    const list = await mcpCall(t.access, "tools/list");
    const tools = (list.body?.result?.tools || []) as Array<{ name: string; annotations?: Record<string, unknown> }>;
    const ann = (n: string) => tools.find((x) => x.name === n)?.annotations;
    for (const n of ["send_sms", "send_email", "send_whatsapp", "send_round_report", "send_contact_sms", "send_contact_email"]) {
      expect(ann(n), n).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    }
    expect(ann("create_prospect")).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false });
    expect(ann("search_clients")).toMatchObject({ readOnlyHint: true, idempotentHint: true });

    // Stdio proxy source of truth: REST /tools serves the same annotations
    const rest = await request(app).get("/api/admin/ai/tools").set("Authorization", `Bearer ${adminToken}`);
    expect(rest.status).toBe(200);
    expect(rest.body.tools.find((x: any) => x.name === "send_sms")?.annotations).toMatchObject({ destructiveHint: true });
    expect(rest.body.instructions).toMatch(/untrusted/i);
  }, 60_000);

  it("audit log never stores uploaded file contents", async () => {
    const t = await issueTokens("aud");
    const b64 = crypto.randomBytes(6000).toString("base64");
    const [[mark]] = await pool.query<RowDataPacket[]>(`SELECT COALESCE(MAX(id), 0) m FROM admin_ai_audit_logs`);
    const call = await mcpCall(t.access, "tools/call", {
      name: "upload_case_document",
      arguments: { client_id: 999999999, doc_type: "other", file_name: "vitest.png", file_base64: b64, confirm: false },
    });
    expect(call.status).toBe(200);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, context_json FROM admin_ai_audit_logs
       WHERE id > ? AND admin_id = ? AND question = '[mcp/remote] upload_case_document'`,
      [mark.m, adminId],
    );
    try {
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const raw = typeof r.context_json === "string" ? r.context_json : JSON.stringify(r.context_json);
        expect(raw).not.toContain(b64.slice(0, 80));
        const ctx = JSON.parse(raw);
        expect(ctx.args.file_base64).toMatchObject({ redacted: "file_content", chars: b64.length });
        expect(ctx.args.file_base64.sha256).toBe(crypto.createHash("sha256").update(b64, "utf8").digest("hex"));
      }
    } finally {
      if (rows.length) await pool.query(`DELETE FROM admin_ai_audit_logs WHERE id IN (?)`, [rows.map((r) => r.id)]);
    }
  }, 60_000);

  it("per-admin hourly MCP ceiling returns rate_limited and audits it", async () => {
    const t = await issueTokens("rl");
    const [[me]] = await pool.query<RowDataPacket[]>(`SELECT role FROM admins WHERE id = ?`, [adminId]);
    const limit = adminAiMcpHourlyLimit(String(me.role));
    for (let i = 0; i < limit; i++) hitRateLimit(`admin-ai:mcp:${adminId}`, limit, 60 * 60 * 1000);
    const [[mark]] = await pool.query<RowDataPacket[]>(`SELECT COALESCE(MAX(id), 0) m FROM admin_ai_audit_logs`);
    const call = await mcpCall(t.access, "tools/call", { name: "pipeline_summary", arguments: {} });
    expect(call.status).toBe(200);
    expect(call.body?.result?.isError).toBe(true);
    expect(String(call.body?.result?.content?.[0]?.text)).toMatch(/rate_limited/);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, status FROM admin_ai_audit_logs WHERE id > ? AND admin_id = ? AND question = '[mcp/remote] pipeline_summary'`,
      [mark.m, adminId],
    );
    try {
      expect(rows.map((r) => r.status)).toContain("rate_limited");
    } finally {
      if (rows.length) await pool.query(`DELETE FROM admin_ai_audit_logs WHERE id IN (?)`, [rows.map((r) => r.id)]);
    }
  }, 60_000);

  it("token endpoint is rate limited per IP (429 + Retry-After)", async () => {
    let limited: request.Response | null = null;
    for (let i = 0; i <= MCP_OAUTH_TOKEN_RATE.max; i++) {
      const res = await request(app)
        .post("/api/mcp/oauth/token")
        .type("form")
        .send({ grant_type: "refresh_token", client_id: `vitest-${RUN_ID}-nobody`, refresh_token: "x" });
      if (res.status === 429) {
        limited = res;
        break;
      }
      expect(res.status).toBe(400);
    }
    expect(limited?.body.error).toBe("rate_limited");
    expect(Number(limited?.headers["retry-after"])).toBeGreaterThan(0);
  }, 120_000);
});
