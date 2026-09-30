import { describe, expect, it } from "vitest";
import {
  calendarPipelineHref,
  calendarTaskHref,
} from "./adminCalendarNav";

describe("calendarPipelineHref", () => {
  it("prefers case id when present", () => {
    expect(calendarPipelineHref(10, 99)).toBe("/admin/pipeline?case=99");
  });

  it("falls back to client id", () => {
    expect(calendarPipelineHref(10, null)).toBe("/admin/pipeline?client=10");
  });

  it("falls back to pipeline root when neither is valid", () => {
    expect(calendarPipelineHref(0, 0)).toBe("/admin/pipeline");
  });
});

describe("calendarTaskHref", () => {
  it("opens case when linked", () => {
    expect(
      calendarTaskHref({ id: 1, case_id: 50, client_id: 9 }),
    ).toBe("/admin/pipeline?case=50");
  });

  it("opens my-tasks deep link when unlinked", () => {
    expect(
      calendarTaskHref({ id: 42, case_id: null, client_id: null }),
    ).toBe("/admin/my-tasks?task=42");
  });
});
