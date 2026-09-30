import { describe, expect, it } from "vitest";
import {
  formatConversationAbsoluteTime,
  formatConversationListTime,
} from "./conversationListTime";

describe("formatConversationListTime", () => {
  const now = new Date(2026, 8, 14, 14, 0, 0); // Sep 14, 2026 2:00 PM local

  it("returns empty for missing/invalid", () => {
    expect(formatConversationListTime(null, { now })).toBe("");
    expect(formatConversationListTime("not-a-date", { now })).toBe("");
  });

  it("formats just now and minutes ago", () => {
    expect(
      formatConversationListTime(new Date(2026, 8, 14, 13, 59, 40), {
        now,
        lang: "en",
      }),
    ).toBe("Just now");
    expect(
      formatConversationListTime(new Date(2026, 8, 14, 13, 45, 0), {
        now,
        lang: "en",
      }),
    ).toBe("15m ago");
    expect(
      formatConversationListTime(new Date(2026, 8, 14, 13, 45, 0), {
        now,
        lang: "es",
      }),
    ).toBe("Hace 15 min");
  });

  it("formats today with clock (relative to injected now, not wall clock)", () => {
    const label = formatConversationListTime(new Date(2026, 8, 14, 11, 35, 0), {
      now,
      lang: "en",
    });
    expect(label).toBe("Today at 11:35 AM");
    expect(
      formatConversationListTime(new Date(2026, 8, 14, 11, 35, 0), {
        now,
        lang: "es",
      }),
    ).toBe("Hoy a las 11:35 AM");
  });

  it("formats yesterday with clock (relative to injected now)", () => {
    expect(
      formatConversationListTime(new Date(2026, 8, 13, 9, 5, 0), {
        now,
        lang: "en",
      }),
    ).toBe("Yesterday at 9:05 AM");
    expect(
      formatConversationListTime(new Date(2026, 8, 13, 9, 5, 0), {
        now,
        lang: "es",
      }),
    ).toBe("Ayer a las 9:05 AM");
  });

  it("formats three days ago", () => {
    expect(
      formatConversationListTime(new Date(2026, 8, 11, 12, 0, 0), {
        now,
        lang: "en",
      }),
    ).toBe("3 days ago");
    expect(
      formatConversationListTime(new Date(2026, 8, 11, 12, 0, 0), {
        now,
        lang: "es",
      }),
    ).toBe("Hace 3 días");
  });

  it("absolute tooltip includes year", () => {
    const abs = formatConversationAbsoluteTime(
      new Date(2026, 8, 11, 12, 0, 0),
      "en",
    );
    expect(abs).toMatch(/2026/);
  });
});
