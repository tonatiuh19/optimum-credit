import { describe, expect, it } from "vitest";
import {
  buildDeterministicMorningBrief,
  isDenverWeekdayMorningWindow,
  morningDigestSubject,
  parseClaudeMorningDigestJson,
  renderMorningDigestBodyHtml,
  type MorningDigestSnapshot,
} from "./adminMorningDigest";

function sampleSnapshot(
  overrides?: Partial<MorningDigestSnapshot>,
): MorningDigestSnapshot {
  return {
    admin: { id: 1, first_name: "Lecca", preferred_language: "en" },
    date_label: "Friday, Aug 28",
    counts: {
      prospects: 2,
      active_clients: 3,
      onboarding: 1,
      pending_payment: 0,
      open_tasks: 2,
      overdue_tasks: 1,
      open_conversations: 1,
      unread_messages: 2,
    },
    pipeline_stages: [{ stage: "prospect", count: 2 }],
    prospects: [{ id: 10, name: "Ana Test", phone: "555", stage: "prospect" }],
    clients: [
      { id: 11, name: "Bob Active", status: "active", stage: "round_1" },
    ],
    tasks: [
      {
        id: 1,
        title: "Call Ana",
        status: "doing",
        priority: "high",
        due_at: "2020-01-01T00:00:00.000Z",
        overdue: true,
      },
    ],
    conversations: [
      {
        id: 5,
        client_id: 10,
        who: "Ana Test",
        unread: 2,
        preview: "Can we talk tomorrow?",
        status: "open",
      },
    ],
    app_url: "https://example.test",
    ...overrides,
  };
}

describe("adminMorningDigest", () => {
  it("parses Claude JSON brief", () => {
    const parsed = parseClaudeMorningDigestJson(`{
      "headline": "Clear the board",
      "quote": "Progress loves a prepared morning.",
      "quote_attribution": "OFG",
      "energy_note": "Good morning, Lecca.",
      "priorities": [{"title": "Call Ana", "why": "Unread SMS", "href": "/admin/conversations"}],
      "conversation_resumes": [{"who": "Ana Test", "resume": "Wants a callback"}],
      "risks": ["Overdue: Call Ana"],
      "wins_or_quiet_note": "Steady pipeline."
    }`);
    expect(parsed?.headline).toBe("Clear the board");
    expect(parsed?.priorities[0].href).toBe("/admin/conversations");
    expect(parsed?.conversation_resumes[0].who).toBe("Ana Test");
  });

  it("rejects incomplete Claude JSON", () => {
    expect(parseClaudeMorningDigestJson(`{"headline":"x"}`)).toBeNull();
  });

  it("builds deterministic brief with priorities and quote", () => {
    const brief = buildDeterministicMorningBrief(sampleSnapshot());
    expect(brief.quote.length).toBeGreaterThan(10);
    expect(brief.priorities.length).toBeGreaterThan(0);
    expect(brief.energy_note).toContain("Lecca");
    expect(brief.risks.some((r) => r.includes("Call Ana"))).toBe(true);
  });

  it("renders HTML with quote and CTAs", () => {
    const snap = sampleSnapshot();
    const html = renderMorningDigestBodyHtml({
      snapshot: snap,
      brief: buildDeterministicMorningBrief(snap),
    });
    expect(html).toContain("Quote of the day");
    expect(html).toContain("/admin/my-tasks");
    expect(html).toContain("Lecca");
  });

  it("Denver morning window rejects weekends", () => {
    const sat = new Date("2026-08-29T15:00:00.000Z");
    expect(isDenverWeekdayMorningWindow(sat, 7)).toBe(false);
  });

  it("prefixes subject with IMPORTANT alert", () => {
    const snap = sampleSnapshot();
    const brief = buildDeterministicMorningBrief(snap);
    const subject = morningDigestSubject(brief, "en");
    expect(subject.startsWith("IMPORTANT 🚨")).toBe(true);
    expect(morningDigestSubject(brief, "es").startsWith("IMPORTANTE 🚨")).toBe(
      true,
    );
  });
});
