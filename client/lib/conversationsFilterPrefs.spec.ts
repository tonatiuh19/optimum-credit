import { describe, expect, it } from "vitest";
import { activeFilterCount, DEFAULT_FILTER_PREFS, parseFilterPrefs } from "@/lib/conversationsFilterPrefs";

describe("conversations filter prefs", () => {
  it("restores saved values and ignores anything malformed", () => {
    expect(parseFilterPrefs(JSON.stringify({ hub: "social", status: "closed", owner: "mine", unread: true, unknownOnly: true, platform: "instagram" }))).toEqual({
      hub: "social",
      status: "closed",
      owner: "mine",
      unread: true,
      unknownOnly: true,
      platform: "instagram",
    });
    expect(parseFilterPrefs("not json")).toEqual(DEFAULT_FILTER_PREFS);
    expect(parseFilterPrefs(null)).toEqual(DEFAULT_FILTER_PREFS);
    expect(parseFilterPrefs(JSON.stringify({ hub: "x", owner: "boss", unread: "yes", platform: "tiktok" }))).toEqual(DEFAULT_FILTER_PREFS);
  });

  it("counts active filters; platform only counts on the Social tab", () => {
    const p = { owner: "unassigned" as const, unread: true, unknownOnly: false, platform: "messenger" as const };
    expect(activeFilterCount(p, true)).toBe(3);
    expect(activeFilterCount(p, false)).toBe(2);
    expect(activeFilterCount(DEFAULT_FILTER_PREFS, true)).toBe(0);
  });
});
