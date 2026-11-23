import { describe, expect, it } from "vitest";
import { formatWindowLeft, socialReplyWindowState } from "@/lib/socialReplyWindow";

const H = 3600_000;
const now = Date.UTC(2026, 10, 23, 12);
const iso = (ms: number) => new Date(ms).toISOString();

describe("socialReplyWindowState", () => {
  it("keeps a live standard window with the time left", () => {
    expect(socialReplyWindowState("standard", iso(now + 5 * H), now)).toEqual({ window: "standard", msLeft: 5 * H });
  });

  it("rolls an expired standard window into Human Agent until day 7", () => {
    expect(socialReplyWindowState("standard", iso(now - H), now)).toEqual({ window: "human_agent", msLeft: 6 * 24 * H - H });
  });

  it("closes an expired Human Agent window", () => {
    expect(socialReplyWindowState("human_agent", iso(now - 1), now)).toEqual({ window: "closed", msLeft: null });
  });

  it("returns null without a window and keeps closed closed", () => {
    expect(socialReplyWindowState(null, null, now)).toBeNull();
    expect(socialReplyWindowState("closed", null, now)).toEqual({ window: "closed", msLeft: null });
  });
});

describe("formatWindowLeft", () => {
  it("uses minutes, hours, then days", () => {
    expect(formatWindowLeft(10 * 60_000)).toEqual({ unit: "minutes", count: 10 });
    expect(formatWindowLeft(18 * H + 59 * 60_000)).toEqual({ unit: "hours", count: 18 });
    expect(formatWindowLeft(5 * 24 * H + H)).toEqual({ unit: "days", count: 5 });
  });
});
