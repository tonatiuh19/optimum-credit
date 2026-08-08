import { describe, expect, it } from "vitest";
import {
  buildConvertProspectBody,
  emptyProspectConvertFormValues,
} from "@/components/admin/ProspectConvertFields";

describe("ProspectConvertFields helpers (New Case prospect stage)", () => {
  it("defaults to opt-out calendar send for convert mode", () => {
    const v = emptyProspectConvertFormValues();
    expect(v.packageId).toBe("__none__");
    expect(v.roundSchedule.send_calendar).toBe(false);
    expect(v.roundSchedule.round_1_date <= v.roundSchedule.round_5_date).toBe(
      true,
    );
  });

  it("builds convert body used by New Case prospect stage submit", () => {
    const v = emptyProspectConvertFormValues();
    v.packageId = "3";
    v.notes = "From New Case · Prospect stage";
    v.roundSchedule = {
      ...v.roundSchedule,
      send_calendar: false,
    };
    const body = buildConvertProspectBody(v);
    expect(body).toEqual({
      package_id: 3,
      notes: "From New Case · Prospect stage",
      round_schedule: v.roundSchedule,
    });
  });
});
