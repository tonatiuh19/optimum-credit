/**
 * Shared helpers for pipeline stage-change confirmation messaging.
 * Used by the admin Pipeline board when a case (or prospect) is dragged
 * to a different stage/column, so every direction (forward, backward, or a
 * multi-step jump) gets a clear, human-readable confirm prompt.
 */
import type { PipelineStage } from "@shared/api";

/** Ordered left-to-right as shown on the Pipeline board case columns
 * (Prospect is a virtual lead column; cases may also use pipeline_stage=prospect). */
export const STAGE_ORDER: PipelineStage[] = [
  "new_client",
  "docs_ready",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
  "cancelled",
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  prospect: "Prospect",
  new_client: "New Client",
  docs_ready: "Docs Verified",
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
  round_4: "Round 4",
  round_5: "Round 5",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type StageMoveDirection = "forward" | "back" | "jump-forward" | "jump-back" | "same";

export function getStageMoveDirection(
  from: PipelineStage,
  to: PipelineStage,
): StageMoveDirection {
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return "same";
  const delta = toIdx - fromIdx;
  if (delta === 1) return "forward";
  if (delta === -1) return "back";
  return delta > 0 ? "jump-forward" : "jump-back";
}

/**
 * Builds a clear confirm() message for any stage index change (forward, back, or a jump
 * across multiple columns), optionally combined with an open-info-request soft warning.
 */
export function buildStageChangeConfirmMessage(opts: {
  from: PipelineStage;
  to: PipelineStage;
  clientName?: string;
  openInfoRequests?: number;
}): string {
  const { from, to, clientName, openInfoRequests = 0 } = opts;
  const direction = getStageMoveDirection(from, to);
  const who = clientName ? `${clientName} ` : "";
  const fromLabel = STAGE_LABELS[from] ?? from;
  const toLabel = STAGE_LABELS[to] ?? to;

  let base: string;
  switch (direction) {
    case "forward":
      base = `Move ${who}forward from "${fromLabel}" to "${toLabel}"?`;
      break;
    case "back":
      base = `Move ${who}backward from "${fromLabel}" to "${toLabel}"? This reverts progress.`;
      break;
    case "jump-forward": {
      const skipped = STAGE_ORDER.indexOf(to) - STAGE_ORDER.indexOf(from) - 1;
      base = `Jump ${who}forward from "${fromLabel}" to "${toLabel}", skipping ${skipped} stage${skipped === 1 ? "" : "s"}?`;
      break;
    }
    case "jump-back": {
      const skipped = STAGE_ORDER.indexOf(from) - STAGE_ORDER.indexOf(to) - 1;
      base = `Jump ${who}backward from "${fromLabel}" to "${toLabel}", skipping ${skipped} stage${skipped === 1 ? "" : "s"}? This reverts progress.`;
      break;
    }
    default:
      base = `Move ${who}to "${toLabel}"?`;
  }

  if (openInfoRequests > 0) {
    base += `\n\nNote: this case has ${openInfoRequests} open info request(s) awaiting client action. Move anyway?`;
  }

  return base;
}
