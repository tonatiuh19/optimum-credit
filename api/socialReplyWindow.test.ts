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

import { metaHistoryAttachments } from "./index";

describe("metaHistoryAttachments (past-DM import → webhook attachment shape)", () => {
  it("maps story mentions, story replies, shared reels, images and unsupported content", () => {
    expect(metaHistoryAttachments({ id: "1", created_time: "", story: { mention: { link: "https://cdn/x" } } })).toEqual([{ type: "story_mention", url: "https://cdn/x" }]);
    expect(metaHistoryAttachments({ id: "2", created_time: "", message: "🔥", story: { reply_to: { link: "" } } })).toEqual([{ type: "story_reply", url: null }]);
    expect(metaHistoryAttachments({ id: "3", created_time: "", shares: { data: [{ link: "https://www.instagram.com/reel/abc/" }] } })).toEqual([
      { type: "share", url: "https://www.instagram.com/reel/abc/" },
    ]);
    expect(metaHistoryAttachments({ id: "4", created_time: "", attachments: { data: [{ mime_type: "image/jpeg", image_data: { url: "https://cdn/i" } }] } })).toEqual([
      { type: "image", url: "https://cdn/i" },
    ]);
    expect(metaHistoryAttachments({ id: "5", created_time: "", is_unsupported: true })).toEqual([{ type: "unsupported", url: null }]);
    expect(metaHistoryAttachments({ id: "6", created_time: "", message: "hi" })).toEqual([]);
  });
});
