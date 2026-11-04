import { describe, expect, it } from "vitest";
import { decodeLiteralUnicodeEscapes } from "./index";
import { mergeClaudeNarrativeEnhancement } from "./ofgReportClaudeEnhance";
import type { OfGReportData } from "../shared/api";

describe("platform unicode decode (LLM double-escape)", () => {
  it("decodeLiteralUnicodeEscapes handles em dash and accents", () => {
    expect(
      decodeLiteralUnicodeEscapes("Hola \\u2014 seguimiento"),
    ).toBe("Hola — seguimiento");
    expect(decodeLiteralUnicodeEscapes("cr\\u00e9dito")).toBe("crédito");
  });

  it("expands literal \\n / \\t (SMS thread visible escapes)", () => {
    expect(decodeLiteralUnicodeEscapes("updates.\\n\\nTo give")).toBe(
      "updates.\n\nTo give",
    );
    expect(
      decodeLiteralUnicodeEscapes("Hola \\u2014 listo.\\n\\nPaso 1"),
    ).toBe("Hola — listo.\n\nPaso 1");
  });

  it("progress report Claude merge decodes narrative strings", () => {
    const base = {
      locale: "en",
      wins: [{ itemRemoved: "XYZ COLLECTION", impact: "old", status: "gone" }],
      targets: [{ item: "ABC BANK", detail: "old", priority: "high" as const }],
      actionPlan: [{ step: 1, description: "base", owner: "ofg" as const }],
      roadmap: { milestones: ["a"], scoreGoal: 700, gapRemaining: 50 },
      positiveAccounts: [],
      actionNeeded: [],
    } as unknown as OfGReportData;
    const out = mergeClaudeNarrativeEnhancement(base, {
      wins: [
        {
          itemRemoved: "XYZ COLLECTION",
          impact: "Removed \\u2014 great win",
          status: "Confirmed",
        },
      ],
      targets: [
        {
          item: "ABC BANK",
          detail: "Still reporting \\u2014 dispute Round 2",
          priority: "high",
        },
      ],
      actionPlan: [
        {
          step: 1,
          description: "Send Round 2 letters \\u2014 wait for results",
          owner: "ofg",
        },
      ],
      roadmap: { milestones: ["Round 2 complete \\u2014 review"] },
    });
    expect(out.wins[0].impact).toBe("Removed — great win");
    expect(out.targets[0].detail).toBe("Still reporting — dispute Round 2");
    expect(out.actionPlan[0].description).toBe(
      "Send Round 2 letters — wait for results",
    );
    expect(out.roadmap.milestones[0]).toBe("Round 2 complete — review");
  });
});
