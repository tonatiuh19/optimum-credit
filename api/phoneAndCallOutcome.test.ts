/**
 * Primo, Oct 22 2026 — Alfredo's calls showed "failed" in OFG while Twilio
 * completed them (the browser labeled an audio error), and 1 in 4 client
 * phones were stored without +1. Twilio's outcome wins; phones store as E.164.
 */
import { describe, expect, it } from "vitest";
import { normalizePhoneFieldsInBody, pickTwilioCallOutcome, toStoredUsPhone } from "./index";

describe("toStoredUsPhone", () => {
  it.each([
    ["559-837-9238", "+15598379238"],
    ["3234756240", "+13234756240"],
    ["(909) 684-0373", "+19096840373"],
    ["+1(785) 886-2254", "+17858862254"],
    ["+1 (323) 830-2816", "+13238302816"],
    ["+(562) 916-5794", "+15629165794"],
    ["1.818.916.6351", "+18189166351"],
    [" +15598379238 ", "+15598379238"],
    ["\u202A+1 (213) 573-4887\u202C", "+12135734887"],
  ])("%s → %s", (raw, out) => expect(toStoredUsPhone(raw)).toBe(out));

  it.each(["+529931096834", "+639774769707", "555-1234", "call me", ""])("leaves %j as is", (raw) => {
    expect(toStoredUsPhone(raw)).toBe(raw);
  });

  it("passes non-strings through", () => {
    expect(toStoredUsPhone(null)).toBeNull();
    expect(toStoredUsPhone(undefined)).toBeUndefined();
  });
});

describe("normalizePhoneFieldsInBody", () => {
  it("normalizes *phone keys only", () => {
    const body = { phone: "559-837-9238", agent_phone: "(909) 684-0373", phone_note: "559-837-9238", name: "Alfredo" };
    normalizePhoneFieldsInBody(body);
    expect(body).toEqual({ phone: "+15598379238", agent_phone: "+19096840373", phone_note: "559-837-9238", name: "Alfredo" });
  });
  it("ignores arrays and non-objects", () => {
    expect(() => normalizePhoneFieldsInBody(["559-837-9238"])).not.toThrow();
    expect(() => normalizePhoneFieldsInBody(null)).not.toThrow();
  });
});

describe("pickTwilioCallOutcome", () => {
  it("Oct 9: browser said failed/10s, Twilio child leg completed 66s with 32014", () => {
    expect(pickTwilioCallOutcome({ status: "completed", duration: "66" }, [{ status: "completed", duration: "66" }], 32014)).toEqual({
      status: "completed",
      durationSec: 66,
      errorCode: "32014",
    });
  });
  it("uses the client leg (no-answer) over the parent", () => {
    expect(pickTwilioCallOutcome({ status: "completed", duration: "20" }, [{ status: "no-answer", duration: "0" }], null)).toEqual({
      status: "no-answer",
      durationSec: 0,
      errorCode: null,
    });
  });
  it("falls back to the parent when there is no child leg", () => {
    expect(pickTwilioCallOutcome({ status: "busy", duration: null }, [], null)?.status).toBe("busy");
  });
  it("null while Twilio has not finalized the call", () => {
    expect(pickTwilioCallOutcome({ status: "in-progress", duration: null }, [], null)).toBeNull();
  });
});
