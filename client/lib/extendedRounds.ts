/**
 * Client-side helpers for extended OFG rounds (keep aligned with api/extendedRounds.ts).
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

export function roundOptionsForMax(maxRounds: unknown): number[] {
  const max = clampMaxRounds(maxRounds);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function extendedRoundsLegend(opts: {
  maxRounds?: number | null;
  highestPublished?: number | null;
  currentRoundHint?: number | null;
}): string | null {
  const max = clampMaxRounds(opts.maxRounds ?? DEFAULT_MAX_ROUNDS);
  if (max <= DEFAULT_MAX_ROUNDS) return null;
  const published = Math.max(0, Number(opts.highestPublished) || 0);
  const hint = Number(opts.currentRoundHint) || 0;
  const shown = Math.max(published, hint, DEFAULT_MAX_ROUNDS);
  return `Special · R${Math.min(shown, max)}/${max}`;
}

/** Suggest next publish round given stage, reports, and case max_rounds. */
export function suggestReportRoundExtended(
  pipelineStage: string,
  reports: { round_number: number }[],
  maxRounds: unknown = DEFAULT_MAX_ROUNDS,
): number {
  const max = clampMaxRounds(maxRounds);
  const published = new Set(
    reports.map((r) => Number(r.round_number)).filter((n) => n >= 1 && n <= max),
  );
  const highest = published.size
    ? Math.max(...Array.from(published))
    : 0;

  if (pipelineStage === "docs_ready") return 1;
  if (pipelineStage === "completed") {
    if (max > highest && highest >= DEFAULT_MAX_ROUNDS) {
      return Math.min(max, highest + 1);
    }
    return Math.min(
      max,
      Math.max(DEFAULT_MAX_ROUNDS, highest || DEFAULT_MAX_ROUNDS),
    );
  }
  const m = String(pipelineStage).match(/^round_(\d+)$/);
  if (!m) return 1;
  const stageN = Number(m[1]);
  if (stageN < DEFAULT_MAX_ROUNDS) {
    return Math.min(max, stageN);
  }
  // round_5+: next unpublished up to max
  for (let r = 1; r <= max; r++) {
    if (!published.has(r)) return r;
  }
  return max;
}
