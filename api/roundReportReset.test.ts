import { describe, expect, it } from "vitest";
import {
  buildRoundResetWarnings,
  cascadeRoundsFrom,
  fallbackPipelineStageAfterRoundReset,
  publishHistoryNotePattern,
  resolveResetPipelineTarget,
  ROUND_RESET_EMAIL_WARNING,
  roundCompleteTriggersFor,
} from "./roundReportReset";

describe("cascadeRoundsFrom", () => {
  it("cascades from N through 5 by default", () => {
    expect(cascadeRoundsFrom(1)).toEqual([1, 2, 3, 4, 5]);
    expect(cascadeRoundsFrom(3)).toEqual([3, 4, 5]);
    expect(cascadeRoundsFrom(5)).toEqual([5]);
  });

  it("cascades through extended max_rounds", () => {
    expect(cascadeRoundsFrom(5, 8)).toEqual([5, 6, 7, 8]);
    expect(cascadeRoundsFrom(7, 8)).toEqual([7, 8]);
  });

  it("returns empty for out-of-range fromRound", () => {
    expect(cascadeRoundsFrom(0)).toEqual([]);
    expect(cascadeRoundsFrom(9, 8)).toEqual([]);
  });
});

describe("resolveResetPipelineTarget", () => {
  it("prefers publish history from_stage", () => {
    expect(
      resolveResetPipelineTarget({
        fromRound: 1,
        historyFromStage: "docs_ready",
      }),
    ).toBe("docs_ready");
    expect(
      resolveResetPipelineTarget({
        fromRound: 2,
        historyFromStage: "round_2",
      }),
    ).toBe("round_2");
  });

  it("falls back to round_N when history missing", () => {
    expect(resolveResetPipelineTarget({ fromRound: 1 })).toBe("round_1");
    expect(resolveResetPipelineTarget({ fromRound: 3 })).toBe("round_3");
    expect(fallbackPipelineStageAfterRoundReset(1)).toBe("round_1");
  });

  it("falls back to round_5 for extended fromRound", () => {
    expect(fallbackPipelineStageAfterRoundReset(6, 8)).toBe("round_5");
    expect(
      resolveResetPipelineTarget({ fromRound: 7, maxRounds: 8 }),
    ).toBe("round_5");
  });
});

describe("publishHistoryNotePattern", () => {
  it("matches finalize notes prefix", () => {
    expect(publishHistoryNotePattern(1)).toBe(
      "OFG Progress Report published — Round 1%",
    );
  });
});

describe("buildRoundResetWarnings", () => {
  it("omits email warning when nothing was sent", () => {
    expect(buildRoundResetWarnings({ mayHaveBeenSent: false })).toEqual([]);
  });

  it("includes email warning when delivery may have happened", () => {
    expect(buildRoundResetWarnings({ mayHaveBeenSent: true })).toEqual([
      ROUND_RESET_EMAIL_WARNING,
    ]);
  });
});

describe("roundCompleteTriggersFor", () => {
  it("maps rounds to trigger events", () => {
    expect(roundCompleteTriggersFor([1, 2])).toEqual([
      "round_1_complete",
      "round_2_complete",
    ]);
  });
});
