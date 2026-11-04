/**
 * Drift guard: api/index.ts inlines pure helpers from api/inboundAi.ts
 * (Vercel monolith forbids sibling runtime imports). Fail if constants /
 * key phrases diverge.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  INBOUND_AI_MAX_SMS_TURNS,
  INBOUND_AI_MAX_VOICE_TURNS,
  INBOUND_AI_MIN_CONFIDENCE,
  INBOUND_AI_SMS_TIMEOUT_MS,
  INBOUND_AI_VOICE_TIMEOUT_MS,
  inboundAiHelpReply,
  inboundAiSystemPrompt,
} from "./inboundAi";

const indexSrc = fs.readFileSync(
  path.join(__dirname, "index.ts"),
  "utf8",
);

describe("inboundAi ↔ api/index.ts sync", () => {
  it("keeps numeric constants aligned", () => {
    expect(indexSrc).toMatch(
      new RegExp(
        `const INBOUND_AI_MAX_SMS_TURNS\\s*=\\s*${INBOUND_AI_MAX_SMS_TURNS}\\b`,
      ),
    );
    expect(indexSrc).toMatch(
      new RegExp(
        `const INBOUND_AI_MAX_VOICE_TURNS\\s*=\\s*${INBOUND_AI_MAX_VOICE_TURNS}\\b`,
      ),
    );
    expect(indexSrc).toMatch(
      new RegExp(
        `const INBOUND_AI_MIN_CONFIDENCE\\s*=\\s*${INBOUND_AI_MIN_CONFIDENCE}\\b`,
      ),
    );
    expect(indexSrc).toMatch(
      /const INBOUND_AI_SMS_TIMEOUT_MS\s*=\s*20_?000\b/,
    );
    expect(indexSrc).toMatch(
      /const INBOUND_AI_VOICE_TIMEOUT_MS\s*=\s*8_?000\b/,
    );
    expect(INBOUND_AI_SMS_TIMEOUT_MS).toBe(20000);
    expect(INBOUND_AI_VOICE_TIMEOUT_MS).toBe(8000);
  });

  it("keeps disclosure + HELP copy aligned", () => {
    const disclosure =
      "If asked whether you are a person, say you are OFG's automated assistant";
    expect(indexSrc).toContain(disclosure);
    expect(inboundAiSystemPrompt("en")).toContain(disclosure);
    expect(indexSrc).not.toContain("Never say you are an AI");
    expect(indexSrc).toContain("(844) 401-9494");
    expect(inboundAiHelpReply("en")).toContain("(844) 401-9494");
    expect(indexSrc).toContain("scheduleInboundAiWork");
    expect(indexSrc).toContain("waitUntil");
    expect(indexSrc).toContain("Claude rejected the API key");
    expect(indexSrc).toContain("function inboundAiClaudeFailureDecision");
    expect(indexSrc).toContain("inbound_ai_failure");
  });

  it("keeps Spanish escalate tokens inlined", () => {
    expect(indexSrc).toMatch(/reembolso/);
    expect(indexSrc).toMatch(/abogado/);
    expect(indexSrc).toMatch(/CANCELAR\|BAJA/);
  });

  it("keeps the one-hold-per-streak + staff-active gates inlined", () => {
    expect(indexSrc).toContain("function inboundAiHoldAlreadySent");
    expect(indexSrc).toContain("function inboundAiStaffRecentlyActive");
    expect(indexSrc).toContain("INBOUND_AI_STAFF_ACTIVE_MINUTES");
    expect(indexSrc).toMatch(/const INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT\s*=\s*120\b/);
    expect(indexSrc).toContain("inbound_ai_hold: true");
  });

  it("keeps INBOUND_AI_ADMIN_IDS allowlist gate inlined", () => {
    expect(indexSrc).toContain("INBOUND_AI_ADMIN_IDS");
    expect(indexSrc).toContain("parseInboundAiAdminAllowlist");
    expect(indexSrc).toContain("function inboundAiMayRunOnAssignedLine");
  });

  it("uses the strict triage tool (auto choice) + text fallback in index.ts", () => {
    expect(indexSrc).toContain('name: "triage_decision"');
    expect(indexSrc).toContain('tool_choice: { type: "auto" }');
    expect(indexSrc).toContain("function parseInboundAiDecisionText(");
  });

  it("inlines the reply safety guard identically", () => {
    const modSrc = fs.readFileSync(path.join(__dirname, "inboundAi.ts"), "utf8");
    const guard = modSrc
      .slice(modSrc.indexOf("// ── Reply safety guard (code-level"))
      .replace(/export function/g, "function")
      .trim();
    expect(indexSrc).toContain(guard);
  });
});
