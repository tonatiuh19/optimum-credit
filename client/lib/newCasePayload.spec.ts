import { describe, expect, it } from "vitest";
import {
  buildNewCaseCreatePayload,
  newCaseShowsConvertTimeFields,
} from "@/lib/newCasePayload";
import { emptyRoundScheduleInput } from "@/components/admin/RoundCalendarScheduleFields";
import { emptyInstallmentDraft } from "@/components/admin/InstallmentDraftFields";

describe("buildNewCaseCreatePayload", () => {
  const roundSchedule = emptyRoundScheduleInput();
  const split = {
    ...emptyInstallmentDraft(1),
    amount: "100",
    due_date: "2026-09-01",
  };

  it("prospect stage omits notes, splits, and round_schedule", () => {
    const payload = buildNewCaseCreatePayload({
      stage: "prospect",
      clientId: 9,
      packageName: "should not send",
      splits: [split],
      roundSchedule: { ...roundSchedule, send_calendar: true },
    });
    expect(payload).toEqual({
      client_id: 9,
      pipeline_stage: "prospect",
      notes: undefined,
      splits: undefined,
      round_schedule: undefined,
    });
    expect(newCaseShowsConvertTimeFields("prospect")).toBe(false);
  });

  it("new_client stage includes notes, splits, and round schedule", () => {
    const payload = buildNewCaseCreatePayload({
      stage: "new_client",
      clientId: 3,
      packageName: "  Pack  ",
      splits: [split, emptyInstallmentDraft(2)],
      roundSchedule,
    });
    expect(payload.client_id).toBe(3);
    expect(payload.pipeline_stage).toBe("new_client");
    expect(payload.notes).toBe("Pack");
    expect(payload.splits).toHaveLength(1);
    expect(payload.splits?.[0].amount_cents).toBe(10000);
    expect(payload.round_schedule).toBe(roundSchedule);
    expect(newCaseShowsConvertTimeFields("new_client")).toBe(true);
  });

  it("omits blank package notes on new_client stage", () => {
    const payload = buildNewCaseCreatePayload({
      stage: "new_client",
      clientId: 1,
      packageName: "   ",
      splits: [],
      roundSchedule,
    });
    expect(payload.notes).toBeUndefined();
    expect(payload.splits).toEqual([]);
  });
});
