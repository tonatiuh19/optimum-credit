import { describe, expect, it } from "vitest";
import { socialReplyWindowInfo } from "./index";

const H = 3600_000;
const now = Date.UTC(2026, 10, 23, 12);

describe("socialReplyWindowInfo (Meta reply window for the Social tab + MCP)", () => {
  it("standard within 24h, ending 24h after their last message", () => {
    const last = new Date(now - 2 * H);
    expect(socialReplyWindowInfo(last, now)).toEqual({ window: "standard", ends_at: new Date(last.getTime() + 24 * H).toISOString() });
  });
  it("human agent from 24h to 7 days, ending at day 7", () => {
    const last = new Date(now - 30 * H);
    expect(socialReplyWindowInfo(last, now)).toEqual({ window: "human_agent", ends_at: new Date(last.getTime() + 7 * 24 * H).toISOString() });
  });
  it("closed after 7 days or with no inbound date", () => {
    expect(socialReplyWindowInfo(new Date(now - 8 * 24 * H), now)).toEqual({ window: "closed", ends_at: null });
    expect(socialReplyWindowInfo(null, now)).toEqual({ window: "closed", ends_at: null });
  });
});
