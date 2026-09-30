/**
 * Pure helpers for OFG Progress Report Round reset.
 * Keep in sync with inlined usage in api/index.ts (no runtime import from API).
 */

const DEFAULT_MAX_ROUNDS = 5;
const ABSOLUTE_MAX_ROUNDS = 12;

function clampMaxRounds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROUNDS;
  return Math.min(
    ABSOLUTE_MAX_ROUNDS,
    Math.max(DEFAULT_MAX_ROUNDS, Math.floor(n)),
  );
}

/** Fallback pipeline stage when publish history is missing. */
export function fallbackPipelineStageAfterRoundReset(
  fromRound: number,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): string {
  const max = clampMaxRounds(maxRounds);
  if (!(fromRound >= 1 && fromRound <= max)) return "round_1";
  // Extended rounds stay on pipeline round_5 until final → completed.
  if (fromRound >= DEFAULT_MAX_ROUNDS) return "round_5";
  // After publishing Round N, pipeline is typically round_{N+1}.
  // Resetting from N without history should land on round_N (or round_1).
  return `round_${fromRound}`;
}

/**
 * Resolve target stage for resetting Round `fromRound` (and higher).
 * Prefer the `from_stage` recorded when Round `fromRound` was published.
 */
export function resolveResetPipelineTarget(opts: {
  fromRound: number;
  historyFromStage?: string | null;
  maxRounds?: number;
}): string {
  const hist = String(opts.historyFromStage || "").trim();
  if (hist) return hist;
  return fallbackPipelineStageAfterRoundReset(
    opts.fromRound,
    opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
  );
}

/** Rounds N..maxRounds inclusive that should be cleared on cascade reset. */
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

export function publishHistoryNotePattern(roundNumber: number): string {
  return `OFG Progress Report published — Round ${roundNumber}%`;
}

/** Warning shown when client/partners may already have received Round PDFs. */
export const ROUND_RESET_EMAIL_WARNING =
  "Client and referral partners may already have received Round PDF(s) by email/SMS. Reset cannot unsend those messages.";

/** Build checklist warnings — email warning only when delivery may have happened. */
export function buildRoundResetWarnings(opts: {
  mayHaveBeenSent: boolean;
}): string[] {
  return opts.mayHaveBeenSent ? [ROUND_RESET_EMAIL_WARNING] : [];
}

/**
 * Reminder trigger events for rounds being cleared.
 * Only ENUM-backed triggers (1–5) — rounds 6+ use safety-fallback notify, not flow ENUM.
 */
export function roundCompleteTriggersFor(rounds: number[]): string[] {
  return rounds
    .filter((r) => r >= 1 && r <= DEFAULT_MAX_ROUNDS)
    .map((r) => `round_${r}_complete`);
}
