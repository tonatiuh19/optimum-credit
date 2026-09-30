import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFY_EVENT_KEYS,
  adminNotifyChannelMasterOn,
  applyAdminNotifyPrefsPatch,
} from "./adminNotifyPrefs";
import type { AdminNotificationPrefs } from "@shared/api";

function allOn(): AdminNotificationPrefs {
  const toggles = Object.fromEntries(
    ADMIN_NOTIFY_EVENT_KEYS.map((k) => [k, true]),
  ) as AdminNotificationPrefs["email"];
  return {
    email: { ...toggles },
    in_app: { ...toggles },
    sms: { ...toggles, morning_digest: false },
  };
}

describe("applyAdminNotifyPrefsPatch", () => {
  it("channel_masters email false turns every email event off (incl. morning_digest)", () => {
    const next = applyAdminNotifyPrefsPatch(allOn(), {
      channel_masters: { email: false },
    });
    expect(adminNotifyChannelMasterOn(next, "email")).toBe(false);
    for (const k of ADMIN_NOTIFY_EVENT_KEYS) {
      expect(next.email[k]).toBe(false);
    }
    expect(next.in_app.purchase_enrollment).toBe(true);
  });

  it("partial email patch does not revive muted events", () => {
    const muted = applyAdminNotifyPrefsPatch(allOn(), {
      channel_masters: { email: false },
    });
    const next = applyAdminNotifyPrefsPatch(muted, {
      email: { inbound_sms: true },
    });
    expect(next.email.inbound_sms).toBe(true);
    expect(next.email.purchase_enrollment).toBe(false);
    expect(next.email.morning_digest).toBe(false);
    expect(adminNotifyChannelMasterOn(next, "email")).toBe(true);
  });
});
