/**
 * Pure call-insights helpers (no DB, no Express).
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * copies in api/index.ts.
 */

export type CallInsightSentimentLabel =
  | "positive"
  | "neutral"
  | "negative"
  | "mixed"
  | "anxious"
  | "frustrated"
  | "hopeful"
  | "confused"
  | "angry";

export type CallInsightsPayload = {
  locale: "en" | "es";
  summary_bullets: string[];
  sentiment: {
    label: CallInsightSentimentLabel;
    score: number;
    feelings: string[];
  };
  topics: string[];
  action_items: string[];
  risk_flags: string[];
  interesting: string[];
  model?: string;
  generated_at?: string;
};

/** Max age to wait for Twilio voicemail transcription before giving up (no Whisper). */
export const CALL_INSIGHTS_TWILIO_TRANSCRIPT_WAIT_MS = 30 * 60 * 1000;

export const CALL_INSIGHTS_SYSTEM = `You are Optimum Financial Group's call analyst for credit-repair staff.
Given a call or voicemail transcript, return ONLY a JSON object (no markdown) with:
{
  "summary_bullets": ["...", "..."],
  "sentiment": {
    "label": "positive|neutral|negative|mixed|anxious|frustrated|hopeful|confused|angry",
    "score": 0.0-1.0,
    "feelings": ["...", "..."]
  },
  "topics": ["..."],
  "action_items": ["..."],
  "risk_flags": ["..."],
  "interesting": ["..."]
}
Rules:
- Be factual; do not invent names, amounts, or promises not in the transcript.
- Prefer the transcript language for feelings words; summary_bullets follow locale hint.
- If transcript is empty/garbled, still return JSON with cautious neutral sentiment and one bullet noting poor audio.`;

export function isCallInsightsFeatureEnabled(
  raw?: string | null,
): boolean {
  // Always on unless explicitly disabled (ops kill-switch).
  // Callers pass process.env.CALL_INSIGHTS_ENABLED from api/index.ts.
  if (raw == null || String(raw).trim() === "") return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * When STT produced no transcript yet, decide next pipeline status.
 * Voicemail without OpenAI Whisper waits for Twilio transcription webhook.
 */
export function decideMissingTranscriptOutcome(args: {
  isVoicemail: boolean;
  hasOpenAi: boolean;
  ageMs: number;
  maxWaitMs?: number;
}):
  | { action: "await_twilio" }
  | { action: "fail"; status: "failed"; error: "stt_empty" }
  | { action: "skip"; status: "skipped"; error: "missing_openai_stt" } {
  const maxWait = args.maxWaitMs ?? CALL_INSIGHTS_TWILIO_TRANSCRIPT_WAIT_MS;
  if (args.isVoicemail && !args.hasOpenAi) {
    if (Number.isFinite(args.ageMs) && args.ageMs < maxWait) {
      return { action: "await_twilio" };
    }
  }
  if (args.hasOpenAi) {
    return { action: "fail", status: "failed", error: "stt_empty" };
  }
  return { action: "skip", status: "skipped", error: "missing_openai_stt" };
}

export function parseCallInsightsJson(
  text: string,
  locale: "en" | "es",
): CallInsightsPayload | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const asStrArr = (v: unknown, max: number, maxLen: number): string[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => String(x || "").trim().slice(0, maxLen))
      .filter(Boolean)
      .slice(0, max);

  const sent = (o.sentiment || {}) as Record<string, unknown>;
  const labelRaw = String(sent.label || "neutral").toLowerCase();
  const allowed: CallInsightSentimentLabel[] = [
    "positive",
    "neutral",
    "negative",
    "mixed",
    "anxious",
    "frustrated",
    "hopeful",
    "confused",
    "angry",
  ];
  const label = (
    allowed.includes(labelRaw as CallInsightSentimentLabel)
      ? labelRaw
      : "neutral"
  ) as CallInsightSentimentLabel;
  let score = Number(sent.score);
  if (!Number.isFinite(score)) score = 0.5;
  score = Math.max(0, Math.min(1, score));

  return {
    locale,
    summary_bullets: asStrArr(o.summary_bullets, 6, 220),
    sentiment: {
      label,
      score,
      feelings: asStrArr(sent.feelings, 5, 40),
    },
    topics: asStrArr(o.topics, 8, 80),
    action_items: asStrArr(o.action_items, 6, 200),
    risk_flags: asStrArr(o.risk_flags, 8, 60),
    interesting: asStrArr(o.interesting, 5, 220),
  };
}
