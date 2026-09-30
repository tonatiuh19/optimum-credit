import { describe, expect, it } from "vitest";
import {
  normalizeReportCompareMode,
  parseDualWinsJson,
  primaryWinsForMode,
  projectExtendedRoundDates,
  reminderTriggerForRound,
  serializeDualWinsJson,
  type OfGWinRow,
} from "./reportCompareMode";

describe("reportCompareMode", () => {
  it("normalizes mode", () => {
    expect(normalizeReportCompareMode("chain")).toBe("chain");
    expect(normalizeReportCompareMode("baseline")).toBe("baseline");
    expect(normalizeReportCompareMode(null)).toBe("baseline");
  });

  it("picks primary wins by mode", () => {
    const a: OfGWinRow[] = [
      {
        itemRemoved: "A",
        bureaus: ["TU"],
        impact: "",
        status: "",
      },
    ];
    const b: OfGWinRow[] = [
      {
        itemRemoved: "B",
        bureaus: ["EX"],
        impact: "",
        status: "",
      },
    ];
    expect(primaryWinsForMode("baseline", a, b)[0].itemRemoved).toBe("B");
    expect(primaryWinsForMode("chain", a, b)[0].itemRemoved).toBe("A");
  });

  it("round-trips dual wins json and accepts legacy arrays", () => {
    const payload = serializeDualWinsJson({
      compareMode: "baseline",
      thisRound: [
        {
          itemRemoved: "X",
          bureaus: ["TU"],
          impact: "i",
          status: "s",
        },
      ],
      sinceEnrollment: [
        {
          itemRemoved: "Y",
          bureaus: ["EX"],
          impact: "i",
          status: "s",
        },
      ],
    });
    const parsed = parseDualWinsJson(payload);
    expect(parsed.thisRound[0].itemRemoved).toBe("X");
    expect(parsed.sinceEnrollment[0].itemRemoved).toBe("Y");
    expect(parseDualWinsJson([{ itemRemoved: "Z" }]).thisRound[0].itemRemoved).toBe(
      "Z",
    );
  });

  it("projects extended round dates from R5 + interval", () => {
    const rows = projectExtendedRoundDates({
      round5Date: "2026-01-01",
      intervalDays: 30,
      maxRounds: 8,
    });
    expect(rows.map((r) => r.round)).toEqual([6, 7, 8]);
    expect(rows[0].date).toBe("2026-01-31");
    expect(rows[1].date).toBe("2026-03-02");
  });

  it("honors extended date overrides", () => {
    const rows = projectExtendedRoundDates({
      round5Date: "2026-01-01",
      intervalDays: 30,
      maxRounds: 7,
      overrides: { "6": "2026-02-15" },
    });
    expect(rows[0].date).toBe("2026-02-15");
    expect(rows[1].date).toBe("2026-03-02");
  });

  it("maps reminder triggers", () => {
    expect(reminderTriggerForRound(3)).toBe("round_3_complete");
    expect(reminderTriggerForRound(5)).toBe("round_5_complete");
    expect(reminderTriggerForRound(8)).toBe("round_extended_complete");
  });
});
