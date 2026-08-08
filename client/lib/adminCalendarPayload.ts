import type {
  AdminCalendarResponse,
  CalendarRoundEvent,
  CalendarSplit,
  CalendarWorkTaskEvent,
} from "@shared/api";

/** Normalize calendar API payload so Redux never drops new event kinds. */
export function normalizeAdminCalendarResponse(
  data: Partial<AdminCalendarResponse> | null | undefined,
): AdminCalendarResponse {
  return {
    splits: (data?.splits ?? []) as CalendarSplit[],
    round_events: (data?.round_events ?? []) as CalendarRoundEvent[],
    work_tasks: (data?.work_tasks ?? []) as CalendarWorkTaskEvent[],
  };
}
