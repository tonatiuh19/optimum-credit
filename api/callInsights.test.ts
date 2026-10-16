import { describe, expect, it } from "vitest";
import {
  decideMissingRecordingOutcome,
  isCallInsightsFeatureEnabled,
  transcriptTextFromTwilioSentences,
  twilioRecordingSidFromUrl,
  twilioTranscriptionErrorCode,
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

describe("twilioRecordingSidFromUrl", () => {
  it("reads a real recording SID and ignores placeholders", () => {
    expect(
      twilioRecordingSidFromUrl(
        "https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE2eda2241638902fa581d125e463127b7.mp3",
      ),
    ).toBe("RE2eda2241638902fa581d125e463127b7");
    expect(
      twilioRecordingSidFromUrl(
        "https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/REcall-ins-1.mp3",
      ),
    ).toBeNull();
    expect(twilioRecordingSidFromUrl("")).toBeNull();
  });
});

describe("transcriptTextFromTwilioSentences", () => {
  it("orders speakers and labels dual-channel lines", () => {
    const text = transcriptTextFromTwilioSentences([
      {
        audioChannelIndex: 2,
        sentenceIndex: 2,
        startTimeSeconds: 1.4,
        text: "This is the office.",
      },
      {
        audioChannelIndex: 1,
        sentenceIndex: 1,
        startTimeSeconds: 0.2,
        text: "Hi, I need help with my report.",
      },
    ]);
    expect(text).toBe(
      "Caller: Hi, I need help with my report.\nAgent: This is the office.",
    );
  });

  it("returns empty for missing sentences", () => {
    expect(transcriptTextFromTwilioSentences(null)).toBe("");
    expect(transcriptTextFromTwilioSentences([{ text: "  " }])).toBe("");
  });
});

describe("twilioTranscriptionErrorCode", () => {
  it("maps the AI addendum block and other failures", () => {
    expect(
      twilioTranscriptionErrorCode(403, {
        code: 46009,
        message: "must accept addendum",
      }),
    ).toBe("twilio_ai_addendum");
    expect(twilioTranscriptionErrorCode(500, { message: "nope" })).toBe(
      "twilio_stt_failed",
    );
    expect(twilioTranscriptionErrorCode(201, {})).toBeNull();
  });
});

describe("decideMissingRecordingOutcome", () => {
  it("waits for a young voicemail that has no recording SID yet", () => {
    expect(
      decideMissingRecordingOutcome({
        isVoicemail: true,
        hasRecordingSid: false,
        ageMs: 5 * 60 * 1000,
      }),
    ).toEqual({ action: "await_twilio" });
  });

  it("stops an old voicemail with no recording", () => {
    expect(
      decideMissingRecordingOutcome({
        isVoicemail: true,
        hasRecordingSid: false,
        ageMs: 31 * 60 * 1000,
      }),
    ).toEqual({ action: "fail", status: "failed", error: "stt_empty" });
  });

  it("submits Twilio transcription when a recording SID is present", () => {
    expect(
      decideMissingRecordingOutcome({
        isVoicemail: false,
        hasRecordingSid: true,
        ageMs: 0,
      }),
    ).toEqual({ action: "transcribe" });
  });

  it("fails a dial recording that is not a Twilio recording SID", () => {
    expect(
      decideMissingRecordingOutcome({
        isVoicemail: false,
        hasRecordingSid: false,
        ageMs: 0,
      }),
    ).toEqual({
      action: "fail",
      status: "failed",
      error: "invalid_recording",
    });
  });
});
