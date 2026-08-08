import { describe, expect, it } from "vitest";
import {
  buildDefaultRoundScheduleDates,
  buildRoundScheduleIcs,
  DEFAULT_ROUND_INTERVAL_DAYS,
  mysqlDateToYmd,
  validateRoundScheduleDates,
} from "./index";

const DATES = {
  round_1_date: "2026-09-01",
  round_2_date: "2026-10-06",
  round_3_date: "2026-11-10",
  round_4_date: "2026-12-15",
  round_5_date: "2027-01-19",
};

describe("round calendar ICS", () => {
  it("prefills five increasing dates", () => {
    const d = buildDefaultRoundScheduleDates(
      new Date("2026-01-01T12:00:00Z"),
      30,
    );
    expect(d.round_1_date).toBe("2026-01-31");
    expect(d.round_2_date).toBe("2026-03-02");
    expect(d.round_5_date > d.round_4_date).toBe(true);
    expect(DEFAULT_ROUND_INTERVAL_DAYS).toBe(35);
  });

  it("emits METHOD:PUBLISH with stable UIDs and all-day DATE values", () => {
    const ics = buildRoundScheduleIcs({
      caseNumber: "CR-00042",
      clientName: "Jane Doe",
      uidNs: "case42-abc",
      dates: DATES,
      lang: "en",
    });
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:oc-case42-abc-r1@optimumcredit.com");
    expect(ics).toContain("UID:oc-case42-abc-r5@optimumcredit.com");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901");
    expect(ics).toContain("DTEND;VALUE=DATE:20260902");
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(5);
    expect(ics).toContain("SUMMARY:Optimum Credit — Round 1 target (CR-00042)");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("bumps SEQUENCE on resend builds", () => {
    const ics = buildRoundScheduleIcs({
      caseNumber: "CR-00042",
      clientName: "Jane Doe",
      uidNs: "case42-abc",
      dates: DATES,
      sequence: 3,
    });
    expect(ics.match(/SEQUENCE:3/g)?.length).toBe(5);
    expect(ics).not.toContain("SEQUENCE:0");
  });

  it("escapes commas and semicolons in SUMMARY/DESCRIPTION", () => {
    const ics = buildRoundScheduleIcs({
      caseNumber: "CR-1",
      clientName: "Doe, Jane; Esq",
      uidNs: "ns1",
      dates: DATES,
    });
    expect(ics).toContain("Doe\\, Jane\\; Esq");
  });
});

describe("validateRoundScheduleDates", () => {
  it("accepts equal consecutive dates (non-decreasing)", () => {
    const v = validateRoundScheduleDates({
      round_1_date: "2026-09-01",
      round_2_date: "2026-09-01",
      round_3_date: "2026-10-01",
      round_4_date: "2026-11-01",
      round_5_date: "2026-12-01",
    });
    expect(v.ok).toBe(true);
  });

  it("rejects invalid calendar days", () => {
    const v = validateRoundScheduleDates({
      ...DATES,
      round_1_date: "2026-02-31",
    });
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Invalid round_1_date/),
    });
  });

  it("rejects decreasing order", () => {
    const v = validateRoundScheduleDates({
      ...DATES,
      round_2_date: "2026-08-01",
    });
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({
      ok: false,
      error: expect.stringMatching(/non-decreasing/),
    });
  });

  it("rejects non YYYY-MM-DD", () => {
    const v = validateRoundScheduleDates({
      ...DATES,
      round_3_date: "09/01/2026",
    });
    expect(v.ok).toBe(false);
  });
});

describe("mysqlDateToYmd", () => {
  it("keeps date-only strings without TZ drift", () => {
    expect(mysqlDateToYmd("2026-09-01")).toBe("2026-09-01");
    expect(mysqlDateToYmd("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
  });

  it("formats Date via UTC Y-M-D (pool timezone +00:00)", () => {
    const d = new Date("2026-09-01T00:00:00.000Z");
    expect(mysqlDateToYmd(d)).toBe("2026-09-01");
  });
});
