/**
 * Inbound AI SMS — "a teammate will follow up" must reach a client at most
 * once per escalation streak, for every escalation reason, and the AI must
 * stay out of threads where staff is texting. Simulates bursts of client
 * texts (text / photo-only / mixed) after every kind of last outbound.
 */
import { describe, expect, it } from "vitest";
import {
  INBOUND_AI_MAX_SMS_TURNS,
  INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT,
  inboundAiEscalationHoldMessage,
  inboundAiHardEscalateReason,
  inboundAiHoldAlreadySent,
  inboundAiStaffActiveMinutes,
  inboundAiStaffRecentlyActive,
} from "./inboundAi";

type Row = { direction: string; body: string | null; metadata_json: Record<string, unknown> | null; provider_status?: string; created_at?: Date };
const NOW = Date.UTC(2026, 9, 24, 0, 22);
const minAgo = (m: number) => new Date(NOW - m * 60_000);
const staff = (body: string, m = 1600): Row => ({ direction: "outbound", body, metadata_json: null, created_at: minAgo(m) });
const ai = (body: string): Row => ({ direction: "outbound", body, metadata_json: { inbound_ai: true, source: "inbound_ai" }, created_at: minAgo(1) });
const legacyHold = (lang: "en" | "es"): Row => ai(inboundAiEscalationHoldMessage(lang));
const taggedHold = (status = "delivered"): Row => ({ ...ai("custom hold"), metadata_json: { inbound_ai: true, inbound_ai_hold: true }, provider_status: status });
const failureHold = (status = "queued"): Row => ({ ...ai("x"), metadata_json: { inbound_ai: true, inbound_ai_failure: true }, provider_status: status });
const inbound = (body: string | null): Row => ({ direction: "inbound", body, metadata_json: null, created_at: minAgo(0) });
const system = (): Row => ({ direction: "system", body: "[Inbound AI] Escalated", metadata_json: { inbound_ai: true } });

/**
 * Replays a burst through the same decisions the SMS handler makes and
 * returns how many holds were texted.
 */
function replay(history: Row[], burst: Array<string | null>, aiTurns = INBOUND_AI_MAX_SMS_TURNS): number {
  const thread = [...history]; // oldest → newest
  let sent = 0;
  for (const body of burst) {
    thread.push(inbound(body));
    const newestFirst = [...thread].reverse();
    if (inboundAiStaffRecentlyActive(newestFirst, NOW, INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT)) continue;
    const hard = inboundAiHardEscalateReason(body ?? "", { isUnknown: false, aiTurnCount: aiTurns });
    const reply = hard === "empty_or_media_only" ? "" : inboundAiEscalationHoldMessage("en");
    if (!hard) continue; // would go to Claude — out of scope here
    if (reply && !inboundAiHoldAlreadySent(newestFirst)) {
      thread.push({ ...taggedHold("queued"), body: reply });
      sent += 1;
    }
    thread.push(system());
  }
  return sent;
}

describe("one hold per escalation streak", () => {
  const bursts: Array<[string, Array<string | null>]> = [
    ["4 texts in a minute (Friday case shape)", ["Sending now.", "It only let me do 500", null, "I'll send other tomorrow"]],
    ["photo only", [null, null]],
    ["10 texts", Array.from({ length: 10 }, (_, i) => `msg ${i}`)],
    ["legal + cancel + human in a row", ["I will call my lawyer", "cancel everything", "speak to a person"]],
  ];
  const lastOutbound: Array<[string, Row[], number]> = [
    // [name, history, holds already pending → expected extra holds when texts carry words]
    ["AI answered before (max turns reached)", [ai("a"), ai("b"), ai("c")], 1],
    ["legacy EN hold already sent", [ai("a"), legacyHold("en")], 0],
    ["legacy ES hold already sent", [ai("a"), legacyHold("es")], 0],
    ["tagged hold already sent", [taggedHold()], 0],
    ["failure hold already sent", [failureHold()], 0],
    ["hold failed to deliver → retry once", [taggedHold("failed")], 1],
    ["hold undelivered → retry once", [failureHold("undelivered")], 1],
    ["staff replied long ago after a hold → new streak", [legacyHold("en"), staff("Hi!", 1600)], 1],
  ];
  for (const [bName, burst] of bursts)
    it.each(lastOutbound)(`${bName} — %s`, (_n, history, expected) => {
      const anyText = burst.some((b) => b && b.trim());
      expect(replay(history, burst)).toBe(anyText ? expected : 0);
    });
});

describe("photo-only never gets a hold, even past max turns", () => {
  it.each([0, 1, INBOUND_AI_MAX_SMS_TURNS, 10])("aiTurnCount=%s", (n) => {
    expect(inboundAiHardEscalateReason("", { isUnknown: false, aiTurnCount: n })).toBe("empty_or_media_only");
    expect(inboundAiHardEscalateReason("  ", { isUnknown: false, aiTurnCount: n })).toBe("empty_or_media_only");
  });
});

describe("AI stays out while staff is texting", () => {
  it.each([
    ["staff texted 79 min ago (Friday case)", [staff("Hey, how's your Friday?", 79)], true],
    ["staff texted 5 min ago", [staff("x", 5)], true],
    ["staff texted exactly at the window", [staff("x", INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT)], true],
    ["staff texted 25 h ago", [staff("x", 1500)], false],
    ["only AI outbounds", [ai("a"), legacyHold("en")], false],
    ["AI after a recent staff text still counts staff", [staff("x", 30), ai("a")], true],
    ["no outbound at all", [], false],
  ] as Array<[string, Row[], boolean]>)("%s", (_n, history, expected) => {
    expect(inboundAiStaffRecentlyActive([...history, inbound("hi")].reverse(), NOW, INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT)).toBe(expected);
    // Friday case shape: no AI reply at all while staff is active.
    if (expected) expect(replay(history, ["Sending now.", "It only let me do 500", null, "ok"])).toBe(0);
  });

  it("window is configurable; 0 turns the gate off; bad values fall back", () => {
    expect(inboundAiStaffActiveMinutes("30")).toBe(30);
    expect(inboundAiStaffActiveMinutes("0")).toBe(0);
    expect(inboundAiStaffRecentlyActive([staff("x", 1)], NOW, 0)).toBe(false);
    for (const raw of [undefined, null, "", "abc", "-5"]) expect(inboundAiStaffActiveMinutes(raw)).toBe(INBOUND_AI_STAFF_ACTIVE_MINUTES_DEFAULT);
  });
});
