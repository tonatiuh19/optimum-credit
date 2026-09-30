import { describe, expect, it } from "vitest";
import {
  CALL_INSIGHTS_SYSTEM,
  decideMissingTranscriptOutcome,
  isCallInsightsFeatureEnabled,
  parseCallInsightsJson,
} from "./callInsights";

describe("isCallInsightsFeatureEnabled", () => {
  it("defaults on; only explicit falsey flags disable", () => {
    expect(isCallInsightsFeatureEnabled(undefined)).toBe(true);
    expect(isCallInsightsFeatureEnabled("")).toBe(true);
    expect(isCallInsightsFeatureEnabled("1")).toBe(true);
    expect(isCallInsightsFeatureEnabled("true")).toBe(true);
    expect(isCallInsightsFeatureEnabled("ON")).toBe(true);
    expect(isCallInsightsFeatureEnabled(" yes ")).toBe(true);
    expect(isCallInsightsFeatureEnabled("0")).toBe(false);
    expect(isCallInsightsFeatureEnabled("false")).toBe(false);
    expect(isCallInsightsFeatureEnabled("off")).toBe(false);
    expect(isCallInsightsFeatureEnabled("no")).toBe(false);
  });
});

describe("decideMissingTranscriptOutcome", () => {
  it("waits for Twilio on young voicemail without OpenAI", () => {
    expect(
      decideMissingTranscriptOutcome({
        isVoicemail: true,
        hasOpenAi: false,
        ageMs: 5 * 60 * 1000,
      }),
    ).toEqual({ action: "await_twilio" });
  });

  it("skips old voicemail without OpenAI after wait window", () => {
    expect(
      decideMissingTranscriptOutcome({
        isVoicemail: true,
        hasOpenAi: false,
        ageMs: 31 * 60 * 1000,
      }),
    ).toEqual({
      action: "skip",
      status: "skipped",
      error: "missing_openai_stt",
    });
  });

  it("fails Dial/answered call when Whisper is configured but empty", () => {
    expect(
      decideMissingTranscriptOutcome({
        isVoicemail: false,
        hasOpenAi: true,
        ageMs: 0,
      }),
    ).toEqual({ action: "fail", status: "failed", error: "stt_empty" });
  });

  it("skips Dial without OpenAI", () => {
    expect(
      decideMissingTranscriptOutcome({
        isVoicemail: false,
        hasOpenAi: false,
        ageMs: 0,
      }),
    ).toEqual({
      action: "skip",
      status: "skipped",
      error: "missing_openai_stt",
    });
  });

  it("uses Whisper path for voicemail when OpenAI is set (no await)", () => {
    expect(
      decideMissingTranscriptOutcome({
        isVoicemail: true,
        hasOpenAi: true,
        ageMs: 1000,
      }),
    ).toEqual({ action: "fail", status: "failed", error: "stt_empty" });
  });
});

describe("parseCallInsightsJson", () => {
  it("parses Claude-shaped JSON with sentiment and bullets", () => {
    const parsed = parseCallInsightsJson(
      `Here you go:\n{"summary_bullets":["Client wants Round 2 update","Asked about FHA"],"sentiment":{"label":"hopeful","score":0.7,"feelings":["optimistic","curious"]},"topics":["FHA","Round 2"],"action_items":["Send Round 2 status SMS"],"risk_flags":["buy_ready"],"interesting":["Mentioned closing date next month"]}`,
      "en",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.summary_bullets).toHaveLength(2);
    expect(parsed!.sentiment.label).toBe("hopeful");
    expect(parsed!.sentiment.score).toBe(0.7);
    expect(parsed!.action_items[0]).toContain("Round 2");
    expect(parsed!.risk_flags).toContain("buy_ready");
  });

  it("falls back to neutral on bad label", () => {
    const parsed = parseCallInsightsJson(
      JSON.stringify({
        summary_bullets: ["x"],
        sentiment: { label: "weird", score: 2, feelings: [] },
        topics: [],
        action_items: [],
        risk_flags: [],
        interesting: [],
      }),
      "es",
    );
    expect(parsed!.sentiment.label).toBe("neutral");
    expect(parsed!.sentiment.score).toBe(1);
    expect(parsed!.locale).toBe("es");
  });

  it("returns null on empty / non-JSON", () => {
    expect(parseCallInsightsJson("", "en")).toBeNull();
    expect(parseCallInsightsJson("no json here", "en")).toBeNull();
  });

  it("clips oversized arrays and strings", () => {
    const parsed = parseCallInsightsJson(
      JSON.stringify({
        summary_bullets: Array.from(
          { length: 20 },
          (_, i) => `b${i}-${"x".repeat(300)}`,
        ),
        sentiment: {
          label: "angry",
          score: -1,
          feelings: Array.from({ length: 10 }, (_, i) => `f${i}`),
        },
        topics: Array.from({ length: 20 }, (_, i) => `t${i}`),
        action_items: ["a"],
        risk_flags: ["r"],
        interesting: ["i"],
      }),
      "en",
    );
    expect(parsed!.summary_bullets).toHaveLength(6);
    expect(parsed!.summary_bullets[0]!.length).toBeLessThanOrEqual(220);
    expect(parsed!.sentiment.feelings).toHaveLength(5);
    expect(parsed!.sentiment.score).toBe(0);
    expect(parsed!.topics).toHaveLength(8);
  });

  it("exports a non-empty system prompt", () => {
    expect(CALL_INSIGHTS_SYSTEM.length).toBeGreaterThan(80);
  });
});
