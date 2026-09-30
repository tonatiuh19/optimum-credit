/** Deep-link helpers for Admin Calendar → Pipeline / My Tasks. */

/** Prefer case deep-link (opens panel even when card isn't on current stage page). */
export function calendarPipelineHref(
  clientId: number,
  caseId?: number | null,
) {
  if (caseId && caseId > 0) return `/admin/pipeline?case=${caseId}`;
  if (clientId > 0) return `/admin/pipeline?client=${clientId}`;
  return "/admin/pipeline";
}

export function calendarTaskHref(task: {
  id: number;
  case_id: number | null;
  client_id: number | null;
}) {
  if (
    (task.case_id && task.case_id > 0) ||
    (task.client_id && task.client_id > 0)
  ) {
    return calendarPipelineHref(task.client_id ?? 0, task.case_id);
  }
  return `/admin/my-tasks?task=${task.id}`;
}
