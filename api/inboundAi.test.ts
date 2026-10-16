import { describe, expect, it } from "vitest";
import {
  buildInboundAiUserPrompt,
  countAiOutboundTurns,
  envFlagOn,
  finalizeInboundAiDecision,
  inboundAiAnthropicReady,
  inboundAiAnthropicKey,
  parseInboundAiDecisionText,
  inboundAiClaudeFailureDecision,
  inboundAiComplianceKeyword,
  inboundAiDetectLang,
  inboundAiEscalationHoldMessage,
  inboundAiHardEscalateReason,
  inboundAiHelpReply,
  inboundAiIsClaudeFailureReason,
  inboundAiLatestOutboundIsFailureHold,
  inboundAiMayRunOnAssignedLine,
  inboundAiSmsEnabled,
  inboundAiVoiceEnabled,
  INBOUND_AI_SMS_TIMEOUT_MS,
  parseInboundAiAdminAllowlist,
  parseInboundAiDecision,
  pickFallbackEscalationAdminId,
} from "./inboundAi";

describe("inboundAi gates", () => {
  it("envFlagOn accepts 1/true/on/yes", () => {
    expect(envFlagOn("1")).toBe(true);
    expect(envFlagOn("true")).toBe(true);
    expect(envFlagOn("0")).toBe(false);
    expect(envFlagOn(undefined)).toBe(false);
  });

  it("SMS/voice flags default off and are independent", () => {
    expect(inboundAiSmsEnabled({})).toBe(false);
    expect(inboundAiVoiceEnabled({})).toBe(false);
    expect(inboundAiSmsEnabled({ INBOUND_AI_SMS_ENABLED: "1" })).toBe(true);
    expect(inboundAiVoiceEnabled({ INBOUND_AI_VOICE_ENABLED: "yes" })).toBe(
      true,
    );
    expect(
      inboundAiSmsEnabled({
        INBOUND_AI_SMS_ENABLED: "1",
        INBOUND_AI_VOICE_ENABLED: "0",
      }),
    ).toBe(true);
    expect(
      inboundAiVoiceEnabled({
        INBOUND_AI_SMS_ENABLED: "1",
        INBOUND_AI_VOICE_ENABLED: "0",
      }),
    ).toBe(false);
  });

  it("requires Anthropic key and assigned line", () => {
    expect(inboundAiAnthropicReady({})).toBe(false);
    expect(inboundAiAnthropicReady({ ANTHROPIC_API_KEY: "sk-x" })).toBe(true);
    // SMS-only key enables SMS triage but never voice
    expect(
      inboundAiAnthropicReady({ ANTHROPIC_SMS_API_KEY: "sk-sms" }, "sms"),
    ).toBe(true);
    expect(
      inboundAiAnthropicReady({ ANTHROPIC_SMS_API_KEY: "sk-sms" }, "voice"),
    ).toBe(false);
    // Pass explicit env so local/CI .env INBOUND_AI_ADMIN_IDS cannot starve this check.
    expect(inboundAiMayRunOnAssignedLine(null, {})).toBe(false);
    expect(inboundAiMayRunOnAssignedLine(0, {})).toBe(false);
    expect(inboundAiMayRunOnAssignedLine(12, {})).toBe(true);
  });

  it("optional INBOUND_AI_ADMIN_IDS allowlist (empty = all assigned)", () => {
    expect(parseInboundAiAdminAllowlist({})).toBeNull();
    expect(parseInboundAiAdminAllowlist({ INBOUND_AI_ADMIN_IDS: "90001" })).toEqual([
      90001,
    ]);
    // Unset → any assigned admin (current / default)
    expect(inboundAiMayRunOnAssignedLine(90001, {})).toBe(true);
    expect(inboundAiMayRunOnAssignedLine(150002, {})).toBe(true);
    // César-only rollout
    expect(
      inboundAiMayRunOnAssignedLine(90001, { INBOUND_AI_ADMIN_IDS: "90001" }),
    ).toBe(true);
    expect(
      inboundAiMayRunOnAssignedLine(150002, { INBOUND_AI_ADMIN_IDS: "90001" }),
    ).toBe(false);
    expect(
      inboundAiMayRunOnAssignedLine(120001, {
        INBOUND_AI_ADMIN_IDS: "90001,150002",
      }),
    ).toBe(false);
    expect(
      inboundAiMayRunOnAssignedLine(150002, {
        INBOUND_AI_ADMIN_IDS: "90001, 150002",
      }),
    ).toBe(true);
    // Set but invalid → nobody (safe)
    expect(
      inboundAiMayRunOnAssignedLine(90001, { INBOUND_AI_ADMIN_IDS: "abc" }),
    ).toBe(false);
    // Trailing commas / blanks ignored
    expect(
      parseInboundAiAdminAllowlist({ INBOUND_AI_ADMIN_IDS: "90001," }),
    ).toEqual([90001]);
    expect(
      inboundAiMayRunOnAssignedLine("90001" as unknown as number, {
        INBOUND_AI_ADMIN_IDS: "90001",
      }),
    ).toBe(true);
  });

  it("keeps Claude SMS timeout well under the 60s Vercel function limit", () => {
    // SMS AI runs after Twilio is acked (waitUntil); leave room to send + notify.
    expect(INBOUND_AI_SMS_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(INBOUND_AI_SMS_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("inboundAiComplianceKeyword", () => {
  it("detects STOP/HELP/START and ignores sentences", () => {
    expect(inboundAiComplianceKeyword("STOP")).toBe("stop");
    expect(inboundAiComplianceKeyword("stop!")).toBe("stop");
    expect(inboundAiComplianceKeyword("BAJA")).toBe("stop");
    expect(inboundAiComplianceKeyword("HELP")).toBe("help");
    expect(inboundAiComplianceKeyword("ayuda")).toBe("help");
    expect(inboundAiComplianceKeyword("START")).toBe("start");
    expect(inboundAiComplianceKeyword("please cancel my service")).toBeNull();
    expect(inboundAiHelpReply("en")).toMatch(/844/);
    expect(inboundAiHelpReply("es")).toMatch(/STOP/);
  });
});

describe("inboundAiHardEscalateReason", () => {
  it("forces unknown + max turns + keyword buckets", () => {
    expect(
      inboundAiHardEscalateReason("hi", { isUnknown: true, aiTurnCount: 0 }),
    ).toBe("unknown_contact");
    expect(
      inboundAiHardEscalateReason("hi", { isUnknown: false, aiTurnCount: 3 }),
    ).toBe("max_turns");
    expect(
      inboundAiHardEscalateReason("I want a refund now", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBe("cancel_refund");
    expect(
      inboundAiHardEscalateReason("quiero un reembolso", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBe("cancel_refund");
    expect(
      inboundAiHardEscalateReason("speak to a manager please", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBe("human_request");
    expect(
      inboundAiHardEscalateReason("how do I dispute Experian?", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBe("bureau_dispute_advice");
    expect(
      inboundAiHardEscalateReason("STOP", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBe("compliance_keyword");
    expect(
      inboundAiHardEscalateReason("What time do you open?", {
        isUnknown: false,
        aiTurnCount: 0,
      }),
    ).toBeNull();
  });
});

describe("inboundAi decision parse/finalize", () => {
  it("parses + downgrades low confidence / empty reply", () => {
    expect(parseInboundAiDecision(null)).toBeNull();
    const ok = parseInboundAiDecision({
      action: "resolve",
      reply: "We open at 9am PT.",
      summary: "Hours FAQ",
      confidence: 0.9,
    });
    expect(ok?.action).toBe("resolve");
    expect(finalizeInboundAiDecision(ok).action).toBe("resolve");

    const low = finalizeInboundAiDecision(
      parseInboundAiDecision({
        action: "reply",
        reply: "ok",
        confidence: 0.2,
      }),
    );
    expect(low.action).toBe("escalate");
    expect(low.escalate_reason).toBe("low_confidence");

    const empty = finalizeInboundAiDecision(
      parseInboundAiDecision({
        action: "resolve",
        reply: "  ",
        confidence: 0.99,
      }),
    );
    expect(empty.action).toBe("escalate");
    expect(empty.escalate_reason).toBe("empty_reply");
  });

  it("Claude auth/HTTP/parse failures still include the hold SMS", () => {
    const auth = inboundAiClaudeFailureDecision("en", "claude_auth");
    expect(auth.action).toBe("escalate");
    expect(auth.escalate_reason).toBe("claude_auth");
    expect(auth.reply).toBe(inboundAiEscalationHoldMessage("en"));
    expect(auth.summary).toContain("rejected the API key");

    const es = inboundAiClaudeFailureDecision("es", "parse_error");
    expect(es.reply).toBe(inboundAiEscalationHoldMessage("es"));
    expect(es.reply.length).toBeGreaterThan(0);

    expect(inboundAiClaudeFailureDecision("en", "claude_timeout").reply).toBe(
      inboundAiEscalationHoldMessage("en"),
    );
    expect(inboundAiClaudeFailureDecision("en", "claude_http").reply).toBe(
      inboundAiEscalationHoldMessage("en"),
    );
  });

  it("detects language and hold copy", () => {
    expect(inboundAiDetectLang("es", "hello")).toBe("es");
    expect(inboundAiDetectLang(null, "Hola, necesito ayuda")).toBe("es");
    expect(inboundAiDetectLang(null, "What is my stage?")).toBe("en");
    expect(inboundAiEscalationHoldMessage("es")).toMatch(/equipo/i);
    expect(inboundAiEscalationHoldMessage("en")).toMatch(/teammate/i);
  });

  it("counts AI outbound turns + picks Cesar-first fallback", () => {
    expect(
      countAiOutboundTurns([
        { direction: "inbound" },
        {
          direction: "outbound",
          metadata_json: { inbound_ai: true },
        },
        {
          direction: "outbound",
          metadata_json: JSON.stringify({ source: "inbound_ai" }),
        },
        { direction: "outbound", metadata_json: {} },
        {
          direction: "outbound",
          metadata_json: { inbound_ai: true, inbound_ai_failure: true },
        },
      ]),
    ).toBe(2);

    expect(inboundAiIsClaudeFailureReason("claude_auth")).toBe(true);
    expect(inboundAiIsClaudeFailureReason("unknown_contact")).toBe(false);
    expect(
      inboundAiLatestOutboundIsFailureHold([
        { direction: "inbound", metadata_json: {} },
        {
          direction: "outbound",
          metadata_json: { inbound_ai_failure: true },
          provider_status: "queued",
        },
      ]),
    ).toBe(true);
    expect(
      inboundAiLatestOutboundIsFailureHold([
        {
          direction: "outbound",
          metadata_json: { inbound_ai_failure: true },
          provider_status: "failed",
        },
      ]),
    ).toBe(false);
    expect(
      inboundAiLatestOutboundIsFailureHold([
        {
          direction: "outbound",
          metadata_json: { inbound_ai: true },
          provider_status: "delivered",
        },
      ]),
    ).toBe(false);

    expect(
      pickFallbackEscalationAdminId({
        languageOwnerId: 1,
        cesarId: 2,
        leccaId: 3,
        angelId: 4,
        lang: "es",
      }),
    ).toBe(2);
    expect(
      pickFallbackEscalationAdminId({
        languageOwnerId: 1,
        cesarId: null,
        leccaId: 3,
        angelId: 4,
        lang: "es",
      }),
    ).toBe(4);
    expect(
      pickFallbackEscalationAdminId({
        languageOwnerId: null,
        cesarId: null,
        leccaId: 3,
        angelId: null,
        lang: "en",
      }),
    ).toBe(3);
  });

  it("builds user prompt with context blocks", () => {
    const p = buildInboundAiUserPrompt({
      displayName: "Ana",
      lang: "es",
      channel: "sms",
      inboundText: "¿Horario?",
      crmContext: "stage=new_client",
      faqContext: "Q: hours",
      threadLines: "Contact: hi",
      aiTurnCount: 1,
    });
    expect(p).toContain("Ana");
    expect(p).toContain("¿Horario?");
    expect(p).toContain("stage=new_client");
  });
});

describe("inboundAiAnthropicKey", () => {
  it("prefers ANTHROPIC_SMS_API_KEY for SMS", () => {
    expect(
      inboundAiAnthropicKey("sms", {
        ANTHROPIC_SMS_API_KEY: " sk-sms ",
        ANTHROPIC_API_KEY: "sk-main",
      }),
    ).toEqual({ apiKey: "sk-sms", slot: "ANTHROPIC_SMS_API_KEY" });
  });

  it("falls back to the shared key when the SMS key is blank", () => {
    expect(
      inboundAiAnthropicKey("sms", {
        ANTHROPIC_SMS_API_KEY: "  ",
        ANTHROPIC_API_KEY: "sk-main",
      }),
    ).toEqual({ apiKey: "sk-main", slot: "ANTHROPIC_API_KEY" });
  });

  it("voice always uses the shared key", () => {
    expect(
      inboundAiAnthropicKey("voice", {
        ANTHROPIC_SMS_API_KEY: "sk-sms",
        ANTHROPIC_API_KEY: "sk-main",
      }),
    ).toEqual({ apiKey: "sk-main", slot: "ANTHROPIC_API_KEY" });
    expect(inboundAiAnthropicKey("voice", {})).toBeNull();
  });
});

describe("parseInboundAiDecisionText (parse_error regression, Oct 5–6)", () => {
  it("accepts raw line breaks inside the reply string", () => {
    const raw =
      '{"action":"resolve","reply":"Hola Ana,\nya recibimos tus documentos.\nTe avisamos pronto.","summary":"docs","confidence":0.9,"escalate_reason":null}'.replace(
        /\\n/g,
        "\n",
      );
    const d = parseInboundAiDecisionText(raw);
    expect(d?.action).toBe("resolve");
    expect(d?.reply).toContain("ya recibimos");
  });

  it("accepts ```json fenced output", () => {
    const d = parseInboundAiDecisionText(
      '```json\n{"action":"escalate","reply":"","summary":"billing","confidence":0.4,"escalate_reason":"billing"}\n```',
    );
    expect(d?.action).toBe("escalate");
  });

  it("returns null for non-JSON text", () => {
    expect(parseInboundAiDecisionText("Lo siento, no puedo ayudar")).toBeNull();
  });
});

describe("ANTHROPIC_SMS_WORKSPACE_ID", () => {
  it("is attached to the SMS key when set", () => {
    expect(
      inboundAiAnthropicKey("sms", {
        ANTHROPIC_SMS_API_KEY: "sk-ant-usr-x",
        ANTHROPIC_SMS_WORKSPACE_ID: " wrkspc_abc ",
      }),
    ).toEqual({
      apiKey: "sk-ant-usr-x",
      slot: "ANTHROPIC_SMS_API_KEY",
      workspaceId: "wrkspc_abc",
    });
  });
  it("is never sent with the shared key", () => {
    expect(
      inboundAiAnthropicKey("voice", {
        ANTHROPIC_API_KEY: "sk-main",
        ANTHROPIC_SMS_WORKSPACE_ID: "wrkspc_abc",
      }),
    ).toEqual({ apiKey: "sk-main", slot: "ANTHROPIC_API_KEY" });
  });
});

describe("parseInboundAiDecisionText (parse_error regression, Oct 5–6)", () => {
  it("accepts raw line breaks inside the reply string", () => {
    const raw =
      '{"action":"resolve","reply":"Hola Ana,\nya recibimos tus documentos.","summary":"docs","confidence":0.9,"escalate_reason":null}';
    const d = parseInboundAiDecisionText(raw);
    expect(d?.action).toBe("resolve");
    expect(d?.reply).toContain("ya recibimos");
  });

  it("accepts fenced json output", () => {
    const d = parseInboundAiDecisionText(
      '```json\n{"action":"escalate","reply":"","summary":"billing","confidence":0.4,"escalate_reason":"billing"}\n```',
    );
    expect(d?.action).toBe("escalate");
  });

  it("returns null for non-JSON text", () => {
    expect(parseInboundAiDecisionText("Lo siento, no puedo ayudar")).toBeNull();
  });
});
