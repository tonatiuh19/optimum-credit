/**
 * Pure helpers for inbound AI SMS / voice triage (unit-tested).
 * Runtime Claude + Twilio I/O stays inline in api/index.ts (Vercel).
 *
 * Gates (default OFF — no behavior change until enabled):
 *   INBOUND_AI_SMS_ENABLED=1
 *   INBOUND_AI_VOICE_ENABLED=1
 * Optional rollout allowlist (empty/unset = all assigned lines):
 *   INBOUND_AI_ADMIN_IDS=90001
 * Requires ANTHROPIC_API_KEY for FAQ auto-replies. Independent of ADMIN_AI_ENABLED.
 * Optional ANTHROPIC_SMS_API_KEY bills SMS triage separately (falls back to
 * ANTHROPIC_API_KEY when unset). Voice always uses ANTHROPIC_API_KEY.
 * ANTHROPIC_SMS_WORKSPACE_ID is required when the SMS key is a user-level
 * "all workspaces" key (sk-ant-usr-…).
 * Does not change Twilio SMS/voice routing — only whether the AI agent runs.
 */

export const INBOUND_AI_MAX_SMS_TURNS = 6;
export const INBOUND_AI_MAX_VOICE_TURNS = 4;
export const INBOUND_AI_MIN_CONFIDENCE = 0.55;
/** SMS AI runs after Twilio is acked (waitUntil), so it can wait longer than voice. */
export const INBOUND_AI_SMS_TIMEOUT_MS = 20_000;
export const INBOUND_AI_VOICE_TIMEOUT_MS = 8_000;

export type InboundAiAction = "resolve" | "escalate" | "reply";

export type InboundAiDecision = {
  action: InboundAiAction;
  reply: string;
  summary: string;
  confidence: number;
  escalate_reason: string | null;
};

export function envFlagOn(raw: string | undefined | null): boolean {
  const v = String(raw ?? "0")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function inboundAiSmsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envFlagOn(env.INBOUND_AI_SMS_ENABLED);
}

export function inboundAiVoiceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envFlagOn(env.INBOUND_AI_VOICE_ENABLED);
}

export type InboundAiChannel = "sms" | "voice";

/** Which env var supplied the key (for logs — never log the key itself). */
export type InboundAiKeySlot = "ANTHROPIC_SMS_API_KEY" | "ANTHROPIC_API_KEY";

/**
 * Resolve the Anthropic key for an inbound AI channel.
 * SMS prefers ANTHROPIC_SMS_API_KEY, then the shared key; voice uses the shared key.
 */
export function inboundAiAnthropicKey(
  channel: InboundAiChannel,
  env: NodeJS.ProcessEnv = process.env,
): { apiKey: string; slot: InboundAiKeySlot; workspaceId?: string } | null {
  if (channel === "sms") {
    const smsKey = String(env.ANTHROPIC_SMS_API_KEY || "").trim();
    if (smsKey) {
      // User-level keys (sk-ant-usr-…) with "all workspaces" access must name
      // the workspace to bill on every request (anthropic-workspace-id).
      const workspaceId = String(env.ANTHROPIC_SMS_WORKSPACE_ID || "").trim();
      return workspaceId
        ? { apiKey: smsKey, slot: "ANTHROPIC_SMS_API_KEY", workspaceId }
        : { apiKey: smsKey, slot: "ANTHROPIC_SMS_API_KEY" };
    }
  }
  const shared = String(env.ANTHROPIC_API_KEY || "").trim();
  return shared ? { apiKey: shared, slot: "ANTHROPIC_API_KEY" } : null;
}

export function inboundAiAnthropicReady(
  env: NodeJS.ProcessEnv = process.env,
  channel: InboundAiChannel = "voice",
): boolean {
  return inboundAiAnthropicKey(channel, env) !== null;
}

/**
 * Parse optional staff allowlist for phased rollout.
 * - unset / blank → null (no extra restriction; any assigned line may run)
 * - "90001" or "90001,150002" → only those admin ids
 */
export function parseInboundAiAdminAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): number[] | null {
  const raw = String(env.INBOUND_AI_ADMIN_IDS ?? "").trim();
  if (!raw) return null;
  const ids = raw
    .split(/[,;\s]+/)
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids;
}

/**
 * Only OFG lines with an assignee (user 2a).
 * When INBOUND_AI_ADMIN_IDS is set, assignee must also be on that list
 * (César-only rollout: INBOUND_AI_ADMIN_IDS=90001). Does not affect
 * non-AI SMS/voice delivery.
 */
export function inboundAiMayRunOnAssignedLine(
  assignedAdminId: number | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const id =
    assignedAdminId != null && Number.isFinite(Number(assignedAdminId))
      ? Number(assignedAdminId)
      : 0;
  if (id <= 0) return false;
  const allow = parseInboundAiAdminAllowlist(env);
  if (allow == null) return true;
  if (allow.length === 0) return false;
  return allow.includes(id);
}

const HARD_ESCALATE_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  {
    reason: "legal_threat",
    re: /\b(lawyer|attorney|sue|lawsuit|legal\s+action|bbb|better\s+business|ftc|cfpb|abogado|demanda|demandar)\b/i,
  },
  {
    reason: "cancel_refund",
    re: /\b(cancel|cancellation|cancelar|cancelaci[oó]n|refund|reembolso|charge\s*back|chargeback|dispute\s+the\s+charge)\b/i,
  },
  {
    reason: "payment_issue",
    re: /\b(card\s+(declined|charged)|overcharg|billing\s+error|wrong\s+amount|payment\s+(failed|problem|issue)|unauthorized\s+charge|pago\s+(fall[oó]|rechaz|problem)|tarjeta\s+rechaz)\b/i,
  },
  {
    reason: "human_request",
    re: /\b(speak\s+to\s+(a\s+)?(person|human|someone|manager|agent|representative)|real\s+person|transfer\s+me|call\s+me\s+back|quiero\s+hablar|con\s+una\s+persona|gerente|representante)\b/i,
  },
  {
    reason: "anger",
    re: /\b(scam|fraud|ripoff|rip\s*off|furious|pissed|worst\s+company|estafa|fraude)\b/i,
  },
  {
    reason: "bureau_dispute_advice",
    re: /\b(how\s+do\s+i\s+dispute|c[oó]mo\s+(disputo|impugno)|dispute\s+(experian|equifax|transunion|the\s+bureau)|remove\s+(this|the)\s+(collection|charge\s*off)|fix\s+my\s+credit|arreglar\s+mi\s+cr[eé]dito)\b/i,
  },
];

/** Exact TCPA keywords (Twilio Advanced Opt-Out style). Not the same as "cancel my service". */
export function inboundAiComplianceKeyword(
  text: string,
): "stop" | "help" | "start" | null {
  const t = String(text || "")
    .trim()
    .toUpperCase()
    .replace(/[!.]+$/g, "");
  if (!t) return null;
  if (/^(STOP|STOPALL|UNSUBSCRIBE|END|QUIT|CANCELAR|BAJA)$/.test(t))
    return "stop";
  if (/^(HELP|INFO|AYUDA)$/.test(t)) return "help";
  if (/^(START|YES|UNSTOP)$/.test(t)) return "start";
  return null;
}

export function inboundAiHelpReply(lang: "en" | "es"): string {
  return lang === "es"
    ? "Optimum Credit: para ayuda escribe a tu especialista o llama al (844) 401-9494. Responde STOP para cancelar mensajes."
    : "Optimum Credit: for help text your specialist or call (844) 401-9494. Reply STOP to opt out.";
}

/**
 * True when the newest outbound text in the thread is an AI message that asked
 * something ("Want a teammate to call you?") — then "ok thanks" is an ANSWER,
 * not a sign-off, and must reach the AI. `recentNewestFirst` may include the
 * inbound being handled.
 */
export function inboundAiLastAiTextAskedQuestion(
  recentNewestFirst: ReadonlyArray<object>,
): boolean {
  type Msg = { direction?: unknown; body?: unknown; metadata_json?: unknown };
  const last = (recentNewestFirst as ReadonlyArray<Msg>).find((m) => String(m.direction) === "outbound");
  if (!last) return false;
  let meta: Record<string, unknown> = {};
  try {
    meta =
      typeof last.metadata_json === "string"
        ? JSON.parse(last.metadata_json)
        : ((last.metadata_json as Record<string, unknown>) ?? {});
  } catch {
    meta = {};
  }
  return meta?.inbound_ai === true && /[?¿]/.test(String(last.body ?? ""));
}

/**
 * Reactions ("Liked “…”") and pure acknowledgments ("ok", "thanks", 👍) need
 * no AI reply and no escalation — staff just see them in the inbox.
 */
export function inboundAiIsAckOnly(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^(liked|loved|laughed at|emphasized|disliked|questioned|reacted\b[^“"]*to|le gust[oó]|me gusta|\S{1,4}\s+to)\s*[“"]/iu.test(t)) return true;
  if (/[?¿]/.test(t)) return false; // any question needs an answer
  const words = t
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/[!.,;:¡]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return true; // emoji only
  if (words.split(" ").length > 14) return false;
  // Thanks/ok phrases chained with fillers ("Awesome, man. Thank you for the update.").
  const ack = [
    "ok(?:ay|ey|i)?", "k", "kk", "thanks?", "thank you", "thx", "ty", "tysm", "gracias", "muchas gracias",
    "mil gracias", "sounds good", "perfect", "perfecto", "great", "awesome", "cool", "nice", "excellent",
    "excelente", "genial", "muy bien", "got it", "noted", "will do", "appreciate it", "i appreciate it",
    "appreciated", "entendido", "de acuerdo", "vale", "listo", "sale", "bueno", "dale", "claro", "you too",
    "igualmente",
  ];
  const filler = [
    "man", "sir", "bro", "cesar", "césar", "primo", "amigo", "amiga", "again", "so much", "very much",
    "a lot", "lol", "for (?:the|your|all the|all your) (?:update|updates|help|info|information)",
    "for (?:everything|all)", "have a (?:good|great|nice|blessed) (?:day|night|weekend|one)",
    "que tengas (?:un )?(?:buen|excelente|lindo) (?:día|dia|fin de semana)", "bendiciones", "god bless",
    "por todo", "por (?:la|tu) (?:información|informacion|ayuda)",
  ];
  // Longest phrase first so "thank you" is not read as "thank" + "you".
  const alt = (xs: string[]) => [...xs].sort((x, y) => y.length - x.length).join("|");
  const unit = new RegExp(`^(?:${alt([...ack, ...filler])})(?: |$)`, "u");
  const ackOnly = new RegExp(`^(?:${alt(ack)})(?: |$)`, "u");
  let rest = words;
  let sawAck = false;
  while (rest) {
    const m = rest.match(unit);
    if (!m) return false;
    if (ackOnly.test(rest)) sawAck = true;
    rest = rest.slice(m[0].length);
  }
  return sawAck;
}

export function inboundAiHardEscalateReason(
  text: string,
  opts: { isUnknown: boolean; aiTurnCount: number; maxTurns?: number },
): string | null {
  // Unknown numbers are answered as prospects (FAQ only, no account data) — Nov 8, 2026.
  const body = String(text || "").trim();
  // Photo-only / empty first: never text a hold back for these, even past max turns.
  if (!body) return "empty_or_media_only";
  const max = opts.maxTurns ?? INBOUND_AI_MAX_SMS_TURNS;
  if (opts.aiTurnCount >= max) return "max_turns";
  // Compliance keywords are handled separately — never treat as FAQ.
  if (inboundAiComplianceKeyword(body)) return "compliance_keyword";
  for (const p of HARD_ESCALATE_PATTERNS) {
    if (p.re.test(body)) return p.reason;
  }
  return null;
}

export function inboundAiDetectLang(
  preferredLanguage: string | null | undefined,
  messageText: string,
): "en" | "es" {
  if (preferredLanguage === "es" || preferredLanguage === "en") {
    return preferredLanguage;
  }
  const t = String(messageText || "");
  if (
    /[áéíóúñ¿¡]/i.test(t) ||
    /\b(hola|gracias|quiero|necesito|por\s+favor|ayuda|cuánto|cuando)\b/i.test(t)
  ) {
    return "es";
  }
  return "en";
}

export function parseInboundAiDecision(raw: unknown): InboundAiDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const actionRaw = String(o.action || "")
    .trim()
    .toLowerCase();
  const action: InboundAiAction | null =
    actionRaw === "resolve" ||
    actionRaw === "escalate" ||
    actionRaw === "reply"
      ? actionRaw
      : null;
  if (!action) return null;
  let confidence = Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));
  const reply = String(o.reply || "")
    .trim()
    .slice(0, 480);
  const reason = inboundAiEscalateCode(o.escalate_reason);
  const summary = String(o.summary || reason.detail || "")
    .trim()
    .slice(0, 500);
  const escalate_reason = reason.code;
  return { action, reply, summary, confidence, escalate_reason };
}

/**
 * Fallback when Claude answers with plain-text JSON instead of the tool call.
 * Tolerates ```json fences and raw line breaks / tabs inside string values
 * (invalid JSON that Claude emits for multi-line SMS replies).
 */
export function parseInboundAiDecisionText(text: string): InboundAiDecision | null {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  const tryParse = (src: string): unknown => {
    try {
      return JSON.parse(src);
    } catch {
      return null;
    }
  };
  let obj = tryParse(match[0]);
  if (!obj) {
    // Escape control characters that appear inside quoted strings.
    let out = "";
    let inStr = false;
    let esc = false;
    for (const ch of match[0]) {
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        } else if (ch === "\n") {
          out += "\\n";
          continue;
        } else if (ch === "\r") {
          continue;
        } else if (ch === "\t") {
          out += "\\t";
          continue;
        }
      } else if (ch === '"') {
        inStr = true;
      }
      out += ch;
    }
    obj = tryParse(out);
  }
  return obj ? parseInboundAiDecision(obj) : null;
}

/** Apply confidence + empty-reply guards after Claude JSON parse. */
export function finalizeInboundAiDecision(
  decision: InboundAiDecision | null,
  opts?: { minConfidence?: number },
): InboundAiDecision {
  const min = opts?.minConfidence ?? INBOUND_AI_MIN_CONFIDENCE;
  if (!decision) {
    return {
      action: "escalate",
      reply: "",
      summary: "Claude returned invalid JSON",
      confidence: 0,
      escalate_reason: "parse_error",
    };
  }
  if (
    (decision.action === "resolve" || decision.action === "reply") &&
    decision.confidence < min
  ) {
    return {
      ...decision,
      action: "escalate",
      escalate_reason: decision.escalate_reason || "low_confidence",
      summary: decision.summary || "Low confidence — escalating to staff",
    };
  }
  if (
    (decision.action === "resolve" || decision.action === "reply") &&
    !decision.reply.trim()
  ) {
    return {
      ...decision,
      action: "escalate",
      escalate_reason: "empty_reply",
      summary: decision.summary || "Empty AI reply — escalating",
    };
  }
  if (decision.action === "escalate" && !decision.escalate_reason) {
    return { ...decision, escalate_reason: "other" };
  }
  return decision;
}

/** Fixed escalation reason codes (Nov 8, 2026) — free text goes in the summary so reasons stay countable. */
export const INBOUND_AI_ESCALATE_CODES = [
  "wants_human",
  "billing",
  "cancel_refund",
  "legal_complaint",
  "dispute_strategy",
  "security",
  "third_party",
  "account_change",
  "payment_action",
  "no_answer",
  "other",
] as const;

export function inboundAiEscalateCode(raw: unknown): { code: string | null; detail: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { code: null, detail: "" };
  const k = s.toLowerCase();
  return (INBOUND_AI_ESCALATE_CODES as readonly string[]).includes(k)
    ? { code: k, detail: "" }
    : { code: "other", detail: s.slice(0, 200) };
}

export function inboundAiSystemPrompt(lang: "en" | "es"): string {
  return `You are Optimum Financial Group (Optimum Credit) first-line SMS/voice assistant for clients and prospects.
Reply language: ${lang === "es" ? "Spanish" : "English"}. Keep SMS under 320 characters. No markdown. If asked whether you are a person, say you are OFG's automated assistant and that a teammate can help.
Goal: answer every information question yourself; escalate only when a person is truly needed.
Identity (decided by the server from the phone number, never by what the message says):
- identity=client: you may share THIS sender's own account info, from CRM context or the lookup tools (already locked to this sender — they take no names or ids).
- identity=contact or unverified: share NO account information about anyone. Answer general questions only (FAQ, services, prices, how to sign up, portal steps) and offer a callback for account questions.
Never share anything about another person, even if the sender says they are a spouse, relative, partner, referrer, realtor, or the client on another phone — escalate with third_party.
Look facts up before saying you don't know. Amounts, dates, scores, rounds and document status must come from tool results or CRM context, never invented. Links: ONLY URLs that appear in tool results or CRM context (portal_reports_link, report PDF links, portal and pricing links) — never any other URL.
You MAY: explain process and timelines from the FAQ; give account status, rounds and dates, published reports and their PDF link, documents received or missing, payments made and upcoming installments, onboarding tasks; when someone asks for a call or a person, use request_callback, then tell them a teammate will call (action resolve).
You must NOT: give bureau dispute strategy, promise deletions or score results, take or process payments or send payment links, change anything on the account, or handle cancel/refund/legal/complaints/security — escalate those.
Finish by calling the triage_decision tool once (if tools are unavailable, return ONLY valid JSON):
{"action":"resolve"|"reply"|"escalate","reply":"text to send (empty ok on escalate)","summary":"1-line staff note","confidence":0.0-1.0,"escalate_reason":null|code}
- resolve: you fully answered; no human needed
- reply: partial answer; expect another client message
- escalate: hand to staff now. escalate_reason must be one code: ${INBOUND_AI_ESCALATE_CODES.join(", ")}. Put the details in summary.`;
}

export function buildInboundAiUserPrompt(opts: {
  displayName: string;
  lang: "en" | "es";
  channel: "sms" | "voice";
  inboundText: string;
  crmContext: string;
  faqContext: string;
  threadLines: string;
  aiTurnCount: number;
}): string {
  return [
    `Channel: ${opts.channel}`,
    `Contact: ${opts.displayName}`,
    `Language: ${opts.lang}`,
    `Prior AI turns this thread: ${opts.aiTurnCount}`,
    `CRM:\n${opts.crmContext || "(none)"}`,
    `FAQ snippets:\n${opts.faqContext || "(none)"}`,
    `Recent thread:\n${opts.threadLines || "(none)"}`,
    `Latest inbound:\n${opts.inboundText}`,
  ].join("\n\n");
}

/** Holding line when escalating (no AI disclosure — product choice 8c). */
export function inboundAiEscalationHoldMessage(lang: "en" | "es"): string {
  return lang === "es"
    ? "Gracias — un miembro del equipo te atenderá en breve."
    : "Thanks — a teammate will follow up with you shortly.";
}

export type InboundAiClaudeFailureReason =
  | "claude_auth"
  | "claude_http"
  | "claude_timeout"
  | "parse_error";

/**
 * Claude auth/HTTP/timeout/parse failures still text the hold line.
 * An empty reply here is what made SMS look dead while voice transferred.
 */
export function inboundAiClaudeFailureDecision(
  lang: "en" | "es",
  reason: InboundAiClaudeFailureReason,
): InboundAiDecision {
  const summary =
    reason === "claude_auth"
      ? "Claude rejected the API key — escalating to staff"
      : reason === "claude_timeout"
        ? "Claude timed out — escalating to staff"
        : reason === "claude_http"
          ? "Claude request failed — escalating to staff"
          : "Claude returned invalid JSON";
  return {
    action: "escalate",
    reply: inboundAiEscalationHoldMessage(lang),
    summary,
    confidence: 0,
    escalate_reason: reason,
  };
}

export function inboundAiResolvedSystemNote(summary: string): string {
  const s = String(summary || "Handled by inbound AI").trim().slice(0, 400);
  return `[Inbound AI] Resolved — ${s}`;
}

export function inboundAiEscalatedSystemNote(
  reason: string,
  summary?: string,
): string {
  const r = String(reason || "escalate").trim().slice(0, 120);
  const s = String(summary || "")
    .trim()
    .slice(0, 280);
  return s
    ? `[Inbound AI] Escalated (${r}) — ${s}`
    : `[Inbound AI] Escalated (${r})`;
}

const INBOUND_AI_CLAUDE_FAILURE_REASONS = new Set([
  "claude_auth",
  "claude_http",
  "claude_timeout",
  "parse_error",
  "claude_unavailable",
]);

/** Auth/HTTP/parse holds are not FAQ turns and must not trip max-turns. */
export function inboundAiIsClaudeFailureReason(
  reason: string | null | undefined,
): boolean {
  return INBOUND_AI_CLAUDE_FAILURE_REASONS.has(String(reason || ""));
}

/**
 * `messagesNewestFirst` is newest id first (the SMS query order).
 * True when the latest outbound is a Claude-failure hold, so we do not
 * text that same hold again on the next inbound.
 */
export function inboundAiLatestOutboundIsFailureHold(
  messagesNewestFirst: Array<{
    direction?: unknown;
    metadata_json?: unknown;
    provider_status?: unknown;
  }>,
): boolean {
  for (const m of messagesNewestFirst) {
    if (String(m.direction || "") !== "outbound") continue;
    const meta = parseMeta(m.metadata_json);
    if (meta?.inbound_ai_failure !== true) return false;
    const status = String(m.provider_status || "").toLowerCase();
    // A failed send should be retried on the next inbound.
    if (status === "failed" || status === "undelivered") return false;
    return true;
  }
  return false;
}

/**
 * `messagesNewestFirst` is newest id first. True when an AI hold ("a teammate
 * will follow up") already went out since the last staff / AI answer, for ANY
 * escalation reason — so a burst of client texts gets one hold, not one each.
 * A failed / undelivered hold does not count (retry on the next inbound).
 */
export function inboundAiHoldAlreadySent(
  messagesNewestFirst: Array<{
    direction?: unknown;
    body?: unknown;
    metadata_json?: unknown;
    provider_status?: unknown;
  }>,
): boolean {
  const holds = new Set([inboundAiEscalationHoldMessage("en"), inboundAiEscalationHoldMessage("es")]);
  for (const m of messagesNewestFirst) {
    if (String(m.direction || "") !== "outbound") continue;
    const meta = parseMeta(m.metadata_json);
    const isAi = meta?.inbound_ai === true || meta?.source === "inbound_ai";
    // Staff wrote (or the AI answered) since — a new streak may get a hold.
    if (!isAi) return false;
    const isHold =
      meta?.inbound_ai_hold === true ||
      meta?.inbound_ai_failure === true ||
      holds.has(String(m.body || "").trim());
    if (!isHold) return false;
    const status = String(m.provider_status || "").toLowerCase();
    if (status === "failed" || status === "undelivered") continue;
    return true;
  }
  return false;
}

/** Minutes after a staff text during which the AI stays out of the thread. */
export const INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT = 1440;

export function inboundAiStaffActiveMinutes(raw: string | undefined | null): number {
  const n = Number(String(raw ?? "").trim());
  return raw != null && String(raw).trim() !== "" && Number.isFinite(n) && n >= 0
    ? n
    : INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT;
}

/**
 * True when a person on staff texted this thread within `minutes` — the client
 * is talking to a human, so the AI must not jump in ("Sending now" after
 * staff asked for a payment is not an FAQ).
 */
export function inboundAiStaffRecentlyActive(
  messagesNewestFirst: Array<{ direction?: unknown; metadata_json?: unknown; created_at?: unknown }>,
  nowMs: number,
  minutes: number,
): boolean {
  if (minutes <= 0) return false;
  for (const m of messagesNewestFirst) {
    if (String(m.direction || "") !== "outbound") continue;
    const meta = parseMeta(m.metadata_json);
    if (meta?.inbound_ai === true || meta?.source === "inbound_ai") continue;
    const at = m.created_at instanceof Date ? m.created_at.getTime() : Date.parse(String(m.created_at || ""));
    if (!Number.isFinite(at)) continue;
    return nowMs - at <= minutes * 60_000;
  }
  return false;
}

export function countAiOutboundTurns(
  messages: Array<{ direction?: string; metadata_json?: unknown }>,
): number {
  let n = 0;
  for (const m of messages) {
    if (String(m.direction || "") !== "outbound") continue;
    const meta = parseMeta(m.metadata_json);
    // Failure holds must not consume the 3-turn FAQ budget.
    if (meta?.inbound_ai_failure === true) continue;
    if (meta?.inbound_ai === true || meta?.source === "inbound_ai") n += 1;
    // Rows are newest first: a staff reply resets the budget (only consecutive AI turns count).
    else break;
  }
  return n;
}

function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** When line owner unset: Cesar → lang owner (Lecca EN / Angel ES) → any of the three. */
export function pickFallbackEscalationAdminId(opts: {
  languageOwnerId: number | null;
  cesarId: number | null;
  leccaId: number | null;
  angelId: number | null;
  lang: "en" | "es";
}): number | null {
  if (opts.cesarId) return opts.cesarId;
  if (opts.lang === "es" && opts.angelId) return opts.angelId;
  if (opts.lang === "en" && opts.leccaId) return opts.leccaId;
  if (opts.languageOwnerId) return opts.languageOwnerId;
  return opts.leccaId || opts.angelId || null;
}

// ── Reply safety guard (code-level, runs on every AI reply before sending) ──

const INBOUND_AI_BILLING_RE =
  /\b(bill|billed|billing|charge|charged|payment|pay|price|cost|fee|invoice|cobro|cobran|cobrar|pago|pagar|precio|costo|factura|mensualidad)\b/i;

/** Billing-topic question: AI may answer from the FAQ, staff always review. */
export function inboundAiIsBillingQuestion(text: string): boolean {
  return INBOUND_AI_BILLING_RE.test(String(text || ""));
}

const INBOUND_AI_PROMISE_RE =
  /\b(guarantee[sd]?|guaranteed|garantiz\w*|100\s*%|we\s*(will|'ll)\s*(remove|delete|erase)|will\s+be\s+(removed|deleted)|(eliminaremos|borraremos|quitaremos)|ser[aá]\s+(eliminad|borrad)\w*)\b/i;

/**
 * Block an AI reply that goes beyond "information + round status + report
 * links". Returns a reason (escalate instead of sending) or null (safe).
 * - links: only exact URLs the platform gave the model (portal / report PDF)
 * - $ amounts, credit scores (300–850) and dates: only if present in the
 *   grounding text (CRM context, FAQ, thread, inbound)
 * - no promises of deletions / guaranteed results
 */
export function checkInboundAiReply(
  reply: string,
  opts: { allowedUrls: string[]; groundingText: string },
): string | null {
  const text = String(reply || "");
  const ground = String(opts.groundingText || "").toLowerCase();
  const urls = text.match(/https?:\/\/[^\s)>\]]+/gi) || [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (!opts.allowedUrls.includes(url)) return "unapproved_link";
  }
  if (/\b(www\.|[a-z0-9-]+\.(com|net|org|io|co|us)\b)/i.test(text.replace(/https?:\/\/[^\s)>\]]+/gi, ""))) {
    return "unapproved_link";
  }
  for (const m of text.match(/\$\s?\d[\d,]*(\.\d{1,2})?/g) || []) {
    const n = m.replace(/[$\s]/g, "");
    if (!ground.includes(n.toLowerCase())) return "unverified_amount";
  }
  for (const m of text.match(/\b[3-8]\d{2}\b/g) || []) {
    const v = Number(m);
    if (v >= 300 && v <= 850 && !ground.includes(m)) return "unverified_score";
  }
  for (const m of text.match(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/g) || []) {
    if (!ground.includes(m.toLowerCase())) return "unverified_date";
  }
  if (INBOUND_AI_PROMISE_RE.test(text)) return "promise";
  return null;
}
