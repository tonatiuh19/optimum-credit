import { describe, expect, it } from "vitest";
import { SMS_MAX_BODY_CHARS, smsSegmentInfo } from "./smsSegments";

describe("smsSegmentInfo", () => {
  it("empty text has zero segments", () => {
    expect(smsSegmentInfo("").segments).toBe(0);
  });

  it("counts GSM single segment", () => {
    const info = smsSegmentInfo("Hello");
    expect(info.encoding).toBe("gsm");
    expect(info.segments).toBe(1);
    expect(info.charsPerSegment).toBe(160);
  });

  it("counts GSM multipart", () => {
    const info = smsSegmentInfo("a".repeat(161));
    expect(info.encoding).toBe("gsm");
    expect(info.segments).toBe(2);
    expect(info.charsPerSegment).toBe(153);
  });

  it("counts UCS-2 for emoji", () => {
    const info = smsSegmentInfo("Hi 👋");
    expect(info.encoding).toBe("ucs2");
    expect(info.segments).toBe(1);
  });

  it("counts GSM multipart at boundary", () => {
    const info = smsSegmentInfo("a".repeat(160));
    expect(info.segments).toBe(1);
    expect(smsSegmentInfo("a".repeat(161)).segments).toBe(2);
  });

  it("counts length at 1600 max", () => {
    const info = smsSegmentInfo("a".repeat(1600));
    expect(info.length).toBe(1600);
    expect(info.segments).toBeGreaterThan(1);
  });
});
