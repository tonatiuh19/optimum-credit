import type {
  CreateCasePayload,
  PipelineStage,
  RoundScheduleInput,
} from "@shared/api";
import type { InstallmentDraft } from "@/components/admin/InstallmentDraftFields";
import { draftToCreateSplitPayload } from "@/components/admin/InstallmentDraftFields";

/**
 * Build POST /admin/cases payload for New Case modal.
 * Prospect stage is minimal — package/notes/splits/calendar wait until convert.
 */
export function buildNewCaseCreatePayload(opts: {
  stage: PipelineStage;
  clientId: number;
  packageName?: string;
  splits?: InstallmentDraft[];
  roundSchedule?: RoundScheduleInput;
}): CreateCasePayload {
  const isProspect = opts.stage === "prospect";
  return {
    client_id: opts.clientId,
    pipeline_stage: opts.stage,
    notes: isProspect
      ? undefined
      : opts.packageName?.trim()
        ? opts.packageName.trim()
        : undefined,
    splits: isProspect
      ? undefined
      : (opts.splits ?? [])
          .filter((s) => s.amount && s.due_date)
          .map((s) => draftToCreateSplitPayload(s)),
    round_schedule: isProspect ? undefined : opts.roundSchedule,
  };
}

/** Fields shown in New Case when stage !== prospect */
export function newCaseShowsConvertTimeFields(stage: PipelineStage): boolean {
  return stage !== "prospect";
}
