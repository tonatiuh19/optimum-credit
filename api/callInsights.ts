/**
 * Pure call-transcript helpers (no DB, no Express).
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * copies in api/index.ts.
 */

/** Max age to wait for a Twilio voicemail transcript before giving up. */
export const CALL_INSIGHTS_TWILIO_TRANSCRIPT_WAIT_MS = 30 * 60 * 1000;

export function isCallInsightsFeatureEnabled(
  raw?: string | null,
): boolean {
  // Always on unless explicitly disabled (ops kill-switch).
  // Callers pass process.env.CALL_INSIGHTS_ENABLED from api/index.ts.
  if (raw == null || String(raw).trim() === "") return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/** Recording SID from a Twilio recording URL. Rejects test placeholders. */
export function twilioRecordingSidFromUrl(
  url: string | null | undefined,
): string | null {
  const m = String(url || "").match(
    /\/(RE[0-9a-f]{32})(?:\.[a-z0-9]+)?(?:[?#]|$)/i,
  );
  return m ? m[1] : null;
}

/** Flatten Twilio batch `sentences` into a readable transcript. */
export function transcriptTextFromTwilioSentences(sentences: unknown): string {
  if (!Array.isArray(sentences)) return "";
  const rows: { start: number; index: number; line: string }[] = [];
  sentences.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    const text = String(o.text || "").trim();
    if (!text) return;
    const ch = Number(o.audioChannelIndex ?? o.audio_channel_index);
    const who = ch === 2 ? "Agent" : ch === 1 ? "Caller" : "";
    const startRaw = Number(o.startTimeSeconds ?? o.start_time);
    const indexRaw = Number(o.sentenceIndex ?? o.sentence_index);
    rows.push({
      start: Number.isFinite(startRaw) ? startRaw : i,
      index: Number.isFinite(indexRaw) ? indexRaw : i,
      line: who ? `${who}: ${text}` : text,
    });
  });
  rows.sort((a, b) => a.start - b.start || a.index - b.index);
  return rows
    .map((r) => r.line)
    .join("\n")
    .slice(0, 65000);
}

/** Map a Twilio transcription HTTP error to a stable pipeline code. */
export function twilioTranscriptionErrorCode(
  httpStatus: number,
  body: unknown,
): "twilio_ai_addendum" | "twilio_stt_failed" | null {
  if (!(httpStatus >= 400)) return null;
  const o =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = Number(o.code);
  const message = String(o.message || "");
  if (httpStatus === 403 && (code === 46009 || /addendum/i.test(message))) {
    return "twilio_ai_addendum";
  }
  return "twilio_stt_failed";
}

/**
 * When there is no transcript yet, decide whether to submit the recording,
 * keep waiting on a voicemail callback, or stop.
 */
export function decideMissingRecordingOutcome(args: {
  isVoicemail: boolean;
  hasRecordingSid: boolean;
  ageMs: number;
  maxWaitMs?: number;
}):
  | { action: "transcribe" }
  | { action: "await_twilio" }
  | {
      action: "fail";
      status: "failed";
      error: "invalid_recording" | "stt_empty";
    } {
  if (args.hasRecordingSid) return { action: "transcribe" };
  const maxWait = args.maxWaitMs ?? CALL_INSIGHTS_TWILIO_TRANSCRIPT_WAIT_MS;
  if (
    args.isVoicemail &&
    Number.isFinite(args.ageMs) &&
    args.ageMs >= 0 &&
    args.ageMs < maxWait
  ) {
    return { action: "await_twilio" };
  }
  if (args.isVoicemail) {
    return { action: "fail", status: "failed", error: "stt_empty" };
  }
  return { action: "fail", status: "failed", error: "invalid_recording" };
}
