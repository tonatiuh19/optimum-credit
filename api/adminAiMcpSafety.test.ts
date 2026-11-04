/**
 * MCP safety (Oct 27, 2026): send tools ask the user, the write list cannot
 * drift from the tool schemas, file contents never reach the audit log, and
 * the 401 challenge is RFC 9728 shaped.
 */
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AI_MCP_INSTRUCTIONS,
  ADMIN_AI_SEND_TOOLS,
  ADMIN_AI_TOOLS,
  ADMIN_AI_WRITE_TOOLS,
  adminAiMcpHourlyLimit,
  adminAiToolAnnotations,
  mcpWwwAuthenticate,
  redactAdminAiAuditPayload,
} from "./index";

const ALIASES = new Set(["send_text", "send_wa"]);
const toolNames = new Set(ADMIN_AI_TOOLS.map((t) => t.name));
const hasConfirmPhrase = (t: (typeof ADMIN_AI_TOOLS)[number]) =>
  Object.prototype.hasOwnProperty.call(
    (t.input_schema as { properties?: Record<string, unknown> }).properties || {},
    "confirm_phrase",
  );

describe("write / send tool lists", () => {
  it("every write tool exists in the tool registry", () => {
    for (const n of ADMIN_AI_WRITE_TOOLS) expect(toolNames.has(n), n).toBe(true);
  });

  it("every tool that takes confirm_phrase is a write tool (except the read-only preview)", () => {
    const missing = ADMIN_AI_TOOLS.filter(
      (t) => hasConfirmPhrase(t) && t.name !== "preview_convert_prospect" && !ADMIN_AI_WRITE_TOOLS.has(t.name),
    ).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("every send tool is also a write tool", () => {
    for (const n of ADMIN_AI_SEND_TOOLS) expect(ADMIN_AI_WRITE_TOOLS.has(n), n).toBe(true);
  });

  it("every tool named send_* is a send tool (new channels cannot slip through)", () => {
    const unlisted = [...toolNames].filter((n) => /^send_/.test(n) && !ADMIN_AI_SEND_TOOLS.has(n));
    expect(unlisted).toEqual([]);
  });

  it("aliases follow their target", () => {
    for (const a of ALIASES) expect(ADMIN_AI_SEND_TOOLS.has(a)).toBe(true);
  });
});

describe("MCP annotations", () => {
  it.each([...ADMIN_AI_SEND_TOOLS])("%s asks the user (destructive, open-world)", (n) => {
    expect(adminAiToolAnnotations(n)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("internal writes stay dry-run friendly but are not idempotent", () => {
    for (const n of ADMIN_AI_WRITE_TOOLS) {
      if (ADMIN_AI_SEND_TOOLS.has(n)) continue;
      expect(adminAiToolAnnotations(n), n).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false });
    }
  });

  it("reads are read-only and idempotent", () => {
    for (const t of ADMIN_AI_TOOLS) {
      if (ADMIN_AI_WRITE_TOOLS.has(t.name)) continue;
      expect(adminAiToolAnnotations(t.name), t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
  });

  it("server instructions mark tool data untrusted and require approval", () => {
    expect(ADMIN_AI_MCP_INSTRUCTIONS).toMatch(/untrusted/i);
    expect(ADMIN_AI_MCP_INSTRUCTIONS).toMatch(/confirm_phrase="CONFIRM"/);
  });
});

describe("audit redaction", () => {
  const b64 = crypto.randomBytes(3000).toString("base64");
  const sha = crypto.createHash("sha256").update(b64, "utf8").digest("hex");

  it("replaces *_base64 fields with size + sha256", () => {
    const out = redactAdminAiAuditPayload({
      source: "mcp_remote",
      args: { client_id: 7, file_base64: b64, attachment_base64: b64, file_name: "id.png" },
    }) as any;
    expect(out.args.file_base64).toEqual({ redacted: "file_content", chars: b64.length, sha256: sha });
    expect(out.args.attachment_base64).toEqual({ redacted: "file_content", chars: b64.length, sha256: sha });
    expect(out.args).toMatchObject({ client_id: 7, file_name: "id.png" });
    expect(JSON.stringify(out)).not.toContain(b64.slice(0, 64));
  });

  it("redacts data: URLs under any key and at any depth, arrays included", () => {
    const url = `data:application/pdf;base64,${b64}`;
    const out = redactAdminAiAuditPayload({ a: { b: [{ doc: url }] }, note: "hi" }) as any;
    expect(out.a.b[0].doc).toMatchObject({ redacted: "file_content", chars: url.length });
    expect(out.note).toBe("hi");
  });

  it("keeps ordinary text, short strings, empties and non-strings unchanged", () => {
    const input = { body: "Hi Ana, see you at 3", file_base64: "", n: 1, ok: true, nil: null, short: "data:x;base64,AA" };
    expect(redactAdminAiAuditPayload(input)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = { args: { file_base64: b64 } };
    redactAdminAiAuditPayload(input);
    expect(input.args.file_base64).toBe(b64);
  });
});

describe("401 challenge + limits", () => {
  it("WWW-Authenticate names resource_metadata (RFC 9728)", () => {
    expect(mcpWwwAuthenticate("https://app.example/")).toBe(
      'Bearer resource_metadata="https://app.example/.well-known/oauth-protected-resource", scope="admin_ai.read"',
    );
  });

  it("super_admin has a higher hourly ceiling, never unlimited", () => {
    expect(adminAiMcpHourlyLimit("admin")).toBe(120);
    // Above the real peak (1,423/h, Oct 8 2026) so bulk work is never cut off.
    expect(adminAiMcpHourlyLimit("super_admin")).toBe(3000);
  });
});
