import { describe, expect, it } from "vitest";
import {
  isInboundSmsInAppEnabled,
  shouldPlayAdminNotifyChime,
  shouldPlayInboundSmsChime,
} from "./inboundSmsNotification";
import type { AdminNotificationPrefs, AdminNotifyEventKey } from "@shared/api";

const EVENT_KEYS: AdminNotifyEventKey[] = [
  "purchase_enrollment",
  "payment_installment",
  "submission_ready_review",
  "submission_doc_upload",
  "submission_info_request",
  "doc_upload_link",
  "round_calendar",
  "work_task_assigned",
  "work_task_overdue",
  "inbound_sms",
  "missed_call",
  "voicemail",
  "funding_doc_upload",
  "funding_application_created",
  "get_credit_report_lead",
  "progress_report_alerts",
  "morning_digest",
];

function allOn(): AdminNotificationPrefs {
  const toggles = Object.fromEntries(
    EVENT_KEYS.map((k) => [k, true]),
  ) as AdminNotificationPrefs["email"];
  return { email: { ...toggles }, in_app: { ...toggles }, sms: { ...toggles } };
}

describe("inboundSmsNotification", () => {
  it("defaults in-app inbound SMS to enabled when prefs not loaded", () => {
    expect(isInboundSmsInAppEnabled(null)).toBe(true);
    expect(isInboundSmsInAppEnabled(undefined)).toBe(true);
  });

  it("respects muted in-app inbound SMS pref", () => {
    const prefs = allOn();
    prefs.in_app.inbound_sms = false;
    expect(isInboundSmsInAppEnabled(prefs)).toBe(false);
  });

  it("requires both sound and in-app for chime", () => {
    const prefs = allOn();
    expect(shouldPlayInboundSmsChime(prefs, false)).toBe(true);
    expect(shouldPlayInboundSmsChime(prefs, true)).toBe(false);
    prefs.in_app.inbound_sms = false;
    expect(shouldPlayInboundSmsChime(prefs, false)).toBe(false);
  });

  it("chimes for missed_call and voicemail when in-app prefs allow", () => {
    const prefs = allOn();
    expect(shouldPlayAdminNotifyChime("missed_call", prefs, false)).toBe(true);
    expect(shouldPlayAdminNotifyChime("voicemail", prefs, false)).toBe(true);
    expect(shouldPlayAdminNotifyChime("missed_call", prefs, true)).toBe(false);
    prefs.in_app.missed_call = false;
    expect(shouldPlayAdminNotifyChime("missed_call", prefs, false)).toBe(false);
    expect(shouldPlayAdminNotifyChime("voicemail", prefs, false)).toBe(true);
  });

  it("does not chime for unrelated bell events", () => {
    expect(
      shouldPlayAdminNotifyChime("purchase_enrollment", allOn(), false),
    ).toBe(false);
  });
});
