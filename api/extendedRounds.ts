/**
 * Extended dispute rounds (special clients).
 * Default program = 5; staff can raise max_rounds up to ABSOLUTE_MAX_ROUNDS.
 * Pipeline stage stays on round_5 while publishing rounds 6..max_rounds.
 * Keep in sync with inlined helpers in api/index.ts (Vercel: no sibling runtime import).
 */

export const DEFAULT_MAX_ROUNDS = 5;
export const ABSOLUTE_MAX_ROUNDS = 12;

export function clampMaxRounds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROUNDS;
  return Math.min(
    ABSOLUTE_MAX_ROUNDS,
    Math.max(DEFAULT_MAX_ROUNDS, Math.floor(n)),
  );
}

/** True when this case is allowed more than the standard 5 rounds. */
export function isExtendedRoundsCase(maxRounds: number): boolean {
  return clampMaxRounds(maxRounds) > DEFAULT_MAX_ROUNDS;
}

/**
 * Stage after publishing round N.
 * Rounds 1–4 advance as today; R5+ stay on round_5 until the final max round → completed.
 */
export function pipelineStageAfterRoundReport(
  roundNumber: number,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): string {
  const max = clampMaxRounds(maxRounds);
  if (roundNumber >= max) return "completed";
  if (roundNumber < 1) return "docs_ready";
  if (roundNumber >= DEFAULT_MAX_ROUNDS) return "round_5";
  return `round_${roundNumber + 1}`;
}

/**
 * Highest round number currently unlocked for publish.
 * On round_5 with max_rounds>5, unlocks highestPublished+1 up to max_rounds.
 */
export function expectedReportRoundForStage(
  pipelineStage: string,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
  highestPublished: number = 0,
): number | null {
  const max = clampMaxRounds(maxRounds);
  const published = Math.max(0, Math.floor(Number(highestPublished) || 0));

  if (pipelineStage === "docs_ready") return 1;

  if (pipelineStage === "completed") {
    // Raised max after graduation: unlock the next report slot (special clients).
    if (max > published && published >= DEFAULT_MAX_ROUNDS) {
      return Math.min(max, published + 1);
    }
    // Standard completed: republish up to R5 (or last published).
    return Math.min(
      max,
      Math.max(DEFAULT_MAX_ROUNDS, published || DEFAULT_MAX_ROUNDS),
    );
  }

  const match = String(pipelineStage).match(/^round_(\d+)$/);
  if (!match) return null;
  const stageN = Number(match[1]);
  if (stageN < DEFAULT_MAX_ROUNDS) return stageN;

  // round_5 (or any round_N>=5): unlock next after last published, capped
  const unlocked = Math.max(DEFAULT_MAX_ROUNDS, published + 1);
  return Math.min(max, unlocked);
}

export function validatePublishRoundNumber(
  roundNumber: number,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): string | null {
  const max = clampMaxRounds(maxRounds);
  if (!(roundNumber >= 1 && roundNumber <= max)) {
    return `round_number must be 1–${max}`;
  }
  return null;
}

/** Rounds cleared by Reset from N through max (inclusive). */
export function cascadeRoundsFrom(
  fromRound: number,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): number[] {
  const max = clampMaxRounds(maxRounds);
  if (!(fromRound >= 1 && fromRound <= max)) return [];
  const out: number[] = [];
  for (let r = fromRound; r <= max; r++) out.push(r);
  return out;
}

/** Pipeline card legend for extended cases, e.g. "Special · R6/8". */
export function extendedRoundsLegend(opts: {
  maxRounds: number;
  highestPublished?: number | null;
  currentRoundHint?: number | null;
}): string | null {
  const max = clampMaxRounds(opts.maxRounds);
  if (max <= DEFAULT_MAX_ROUNDS) return null;
  const published = Math.max(0, Number(opts.highestPublished) || 0);
  const hint = Number(opts.currentRoundHint) || 0;
  const shown = Math.max(published, hint, DEFAULT_MAX_ROUNDS);
  return `Special · R${Math.min(shown, max)}/${max}`;
}
