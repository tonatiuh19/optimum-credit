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

  it("preserves extended round_events kind + label", () => {
    const normalized = normalizeAdminCalendarResponse({
      round_events: [
        {
          id: "12-extended-target",
          case_id: 12,
          case_number: "CR-12",
          client_id: 3,
          client_first_name: "Ana",
          client_last_name: "Ruiz",
          round_number: 6,
          target_date: "2030-07-01",
          kind: "extended",
          label: "Round 6 target",
        },
      ],
    });
    expect(normalized.round_events[0].kind).toBe("extended");
    expect(normalized.round_events[0].label).toBe("Round 6 target");
    expect(normalized.round_events[0].round_number).toBe(6);
  });
});
