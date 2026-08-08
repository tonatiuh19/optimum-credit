import { describe, expect, it } from "vitest";
import { normalizeAdminCalendarResponse } from "./adminCalendarPayload";

describe("normalizeAdminCalendarResponse", () => {
  it("preserves work_tasks from the API (regression: thunk used to drop them)", () => {
    const normalized = normalizeAdminCalendarResponse({
      splits: [],
      round_events: [],
      work_tasks: [
        {
          id: 9,
          title: "Follow up",
          status: "backlog",
          priority: "high",
          due_date: "2030-06-15",
          assignee_admin_id: 1,
          assignee_name: "Ada",
          case_id: 3,
          case_number: "CR-3",
          client_id: 2,
          client_first_name: "Pat",
          client_last_name: "Lee",
          source: "hubspot",
        },
      ],
    });
    expect(normalized.work_tasks).toHaveLength(1);
    expect(normalized.work_tasks[0].id).toBe(9);
    expect(normalized.work_tasks[0].due_date).toBe("2030-06-15");
  });

  it("defaults missing arrays to empty (backward compatible)", () => {
    expect(normalizeAdminCalendarResponse({})).toEqual({
      splits: [],
      round_events: [],
      work_tasks: [],
    });
    expect(normalizeAdminCalendarResponse(null)).toEqual({
      splits: [],
      round_events: [],
      work_tasks: [],
    });
  });
});
