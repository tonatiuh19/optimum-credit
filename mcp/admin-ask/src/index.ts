/**
 * Optimum Credit — Admin Ask MCP (stdio)
 *
 * Proxies the same curated CRM tools as in-app Ask (read + guided writes):
 *   GET  /api/admin/ai/tools
 *   POST /api/admin/ai/tools/:name
 *
 * Write tools require confirm=true after a dry-run preview (API-enforced).
 * Auth: Bearer OPTIMUM_ADMIN_TOKEN
 *   - Admin session token from the app, OR
 *   - ADMIN_AI_MCP_TOKEN from server env (pair with ADMIN_AI_MCP_ADMIN_ID)
 *
 * Env:
 *   OPTIMUM_API_BASE_URL  e.g. https://www.ofgllc.com  or http://localhost:8080
 *   OPTIMUM_ADMIN_TOKEN   Bearer token (no "Bearer " prefix)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** Must match API ADMIN_AI_MCP_WRITE_TOOLS — writes are confirm-gated, not idempotent. */
const WRITE_TOOLS = new Set([
  "create_prospect",
  "create_work_task",
  "add_case_note",
  "upload_case_document",
  "send_email",
  "send_sms",
  "update_pipeline_stage",
  "convert_prospect",
  "update_client_status",
  "upsert_progress_report",
  "upsert_payment_splits",
  "update_payment_split",
]);

/** Convert API JSON Schema → Zod so MCP advertises real args per tool. */
function inputSchemaToZod(
  inputSchema: Record<string, unknown>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const props =
    inputSchema.properties &&
    typeof inputSchema.properties === "object" &&
    !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.map(String)
      : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(props)) {
    const p = prop || {};
    let base: z.ZodTypeAny;
    if (Array.isArray(p.enum) && p.enum.length > 0) {
      const vals = p.enum.map(String) as [string, ...string[]];
      base = z.enum(vals);
    } else if (p.type === "integer") {
      base = z.coerce.number().int();
    } else if (p.type === "number") {
      base = z.coerce.number();
    } else if (p.type === "boolean") {
      base = z.preprocess((v) => {
        if (v === true || v === "true" || v === 1 || v === "1") return true;
        if (v === false || v === "false" || v === 0 || v === "0") return false;
        return v;
      }, z.boolean());
    } else if (p.type === "array") {
      const items = (p.items || {}) as Record<string, unknown>;
      if (Array.isArray(items.enum) && items.enum.length > 0) {
        const vals = items.enum.map(String) as [string, ...string[]];
        base = z.array(z.enum(vals));
      } else if (items.type === "integer") {
        base = z.array(z.coerce.number().int());
      } else if (items.type === "number") {
        base = z.array(z.coerce.number());
      } else {
        base = z.array(z.string());
      }
    } else {
      base = z.string();
    }
    if (typeof p.description === "string" && p.description) {
      base = base.describe(p.description);
    }
    shape[key] = required.has(key) ? base : base.optional();
  }
  return z.object(shape).passthrough();
}

function requireEnv(name: string): string {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    console.error(`[optimum-admin-ask-mcp] missing env ${name}`);
    process.exit(1);
  }
  return v;
}

function createApi(): AxiosInstance {
  const baseURL = requireEnv("OPTIMUM_API_BASE_URL").replace(/\/$/, "");
  const token = requireEnv("OPTIMUM_ADMIN_TOKEN");
  return axios.create({
    baseURL,
    timeout: 45_000,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    validateStatus: () => true,
  });
}

async function listTools(api: AxiosInstance): Promise<ToolDef[]> {
  const res = await api.get<{ tools?: ToolDef[]; error?: string }>(
    "/api/admin/ai/tools",
  );
  if (res.status === 404) {
    throw new Error(
      "Admin AI is disabled on the API (set ADMIN_AI_ENABLED=1).",
    );
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      res.data?.error || `Failed to list tools (HTTP ${res.status})`,
    );
  }
  return Array.isArray(res.data?.tools) ? res.data.tools : [];
}

async function callTool(
  api: AxiosInstance,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const res = await api.post<{
    ok?: boolean;
    data?: unknown;
    error?: string;
    message?: string;
  }>(`/api/admin/ai/tools/${encodeURIComponent(name)}`, cleaned);

  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      text: JSON.stringify(
        {
          error: res.data?.error || `HTTP ${res.status}`,
          message: res.data?.message,
        },
        null,
        2,
      ),
    };
  }
  return {
    ok: true,
    text: JSON.stringify(res.data?.data ?? res.data, null, 2),
  };
}

async function main() {
  const api = createApi();
  let tools: ToolDef[];
  try {
    tools = await listTools(api);
  } catch (err: any) {
    console.error(
      "[optimum-admin-ask-mcp] cannot reach Admin AI tools:",
      err?.message ?? err,
    );
    process.exit(1);
  }

  if (tools.length === 0) {
    console.error("[optimum-admin-ask-mcp] API returned zero tools");
    process.exit(1);
  }

  const server = new McpServer({
    name: "optimum-admin-ask",
    version: "1.0.0",
  });

  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        title: t.name,
        description: t.description,
        inputSchema: inputSchemaToZod(t.input_schema || {}),
        annotations: {
          // Dry-runs must not require Claude UI approval (see add_case_note /
          // convert_prospect "No approval received" bugs).
          // API still requires confirm_phrase=CONFIRM for writes.
          title: WRITE_TOOLS.has(t.name)
            ? `${t.name} (dry-run safe; confirm gated)`
            : t.name,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: !WRITE_TOOLS.has(t.name),
          openWorldHint: false,
        },
      },
      async (args) => {
        const result = await callTool(
          api,
          t.name,
          args as Record<string, unknown>,
        );
        return {
          content: [{ type: "text" as const, text: result.text }],
          isError: !result.ok,
        };
      },
    );
  }

  console.error(
    `[optimum-admin-ask-mcp] registered ${tools.length} tool(s): ${tools
      .map((t) => t.name)
      .join(", ")}`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[optimum-admin-ask-mcp] fatal", err);
  process.exit(1);
});
