import { describe, expect, it } from "vitest";
import { buildStaticConversationSuggestions } from "./conversationSuggestedReplies";

describe("buildStaticConversationSuggestions", () => {
  it("returns unknown-thread intro suggestions in English", () => {
    const items = buildStaticConversationSuggestions({
      kind: "unknown",
      mergeContext: { first_name: "", last_name: "", phone: "+15551234567" },
      clientStatus: "unknown",
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((s) => s.id.includes("unk-intro-en"))).toBe(true);
  });

  it("returns Spanish suggestions when preferredLanguage is es", () => {
    const items = buildStaticConversationSuggestions({
      kind: "client",
      mergeContext: {
        first_name: "Maria",
        last_name: "Lopez",
        phone: "+15551234567",
      },
      clientStatus: "prospect",
      preferredLanguage: "es",
    });
    expect(items.some((s) => s.id.includes("-es"))).toBe(true);
  });
});
