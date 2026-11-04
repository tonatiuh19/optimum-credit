import { describe, expect, it } from "vitest";
import {
  clampMaxRounds,
  extendedRoundsLegend,
  roundOptionsForMax,
  suggestReportRoundExtended,
} from "./extendedRounds";

describe("roundOptionsForMax", () => {
  it("builds 1..max", () => {
    expect(roundOptionsForMax(5)).toEqual([1, 2, 3, 4, 5]);
    expect(roundOptionsForMax(8)).toHaveLength(8);
    expect(roundOptionsForMax(99)).toHaveLength(24);
    expect(roundOptionsForMax(24)[23]).toBe(24);
  });
});

describe("suggestReportRoundExtended", () => {
  it("suggests next after published when on round_5 extended", () => {
    expect(
      suggestReportRoundExtended(
        "round_5",
        [1, 2, 3, 4, 5].map((round_number) => ({ round_number })),
        8,
      ),
    ).toBe(6);
  });

  it("falls back to stage for standard path", () => {
    expect(suggestReportRoundExtended("round_2", [{ round_number: 1 }], 5)).toBe(
      2,
    );
  });

  it("suggests R6 after completed when max raised", () => {
    expect(
      suggestReportRoundExtended(
        "completed",
        [1, 2, 3, 4, 5].map((round_number) => ({ round_number })),
        8,
      ),
    ).toBe(6);
  });
});

describe("extendedRoundsLegend / clamp", () => {
  it("legend and clamp", () => {
    expect(clampMaxRounds(2)).toBe(5);
    expect(extendedRoundsLegend({ maxRounds: 5 })).toBeNull();
    expect(
      extendedRoundsLegend({ maxRounds: 8, highestPublished: 6 }),
    ).toBe("Special · R6/8");
  });
});
