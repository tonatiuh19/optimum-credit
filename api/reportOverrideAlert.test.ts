import { describe, expect, it } from "vitest";
import { reportOverrideAlertAdminIds, reportOverrideAlertRecipients } from "./index";

describe("self-check override alert recipients", () => {
  it("defaults to Cesar", () => {
    expect(reportOverrideAlertAdminIds({})).toEqual([90001]);
  });
  it("alerts Cesar when Lecca overrides, never the person who overrode", () => {
    expect(reportOverrideAlertRecipients(150002, {})).toEqual([90001]);
    expect(reportOverrideAlertRecipients(90001, {})).toEqual([]);
  });
  it("honors REPORT_OVERRIDE_ALERT_ADMIN_IDS and drops junk", () => {
    expect(reportOverrideAlertRecipients(150002, { REPORT_OVERRIDE_ALERT_ADMIN_IDS: "90001, 30001,x,150002" })).toEqual([90001, 30001]);
  });
});
