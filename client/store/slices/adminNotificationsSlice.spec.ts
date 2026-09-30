import { describe, expect, it } from "vitest";
import adminNotificationsReducer, {
  fetchNotificationPrefs,
  saveNotificationPrefs,
} from "@/store/slices/adminNotificationsSlice";
import type { AdminNotificationPrefs } from "@shared/api";
import { ADMIN_NOTIFY_EVENT_KEYS } from "@/lib/adminNotifyPrefs";

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

const channels = {
  email: { available: true },
  in_app: { available: true },
  sms: { available: false },
};

describe("adminNotificationsSlice prefs races", () => {
  it("keeps optimistic mute when a concurrent fetch fulfills mid-save", () => {
    let state = adminNotificationsReducer(undefined, { type: "@@init" });
    state = {
      ...state,
      prefs: allOn(),
      channels,
      events: [...ADMIN_NOTIFY_EVENT_KEYS],
    };

    state = adminNotificationsReducer(
      state,
      saveNotificationPrefs.pending("", {
        email: { purchase_enrollment: false },
      }),
    );
    expect(state.prefsSaving).toBe(true);
    expect(state.prefs?.email.purchase_enrollment).toBe(false);

    state = adminNotificationsReducer(
      state,
      fetchNotificationPrefs.fulfilled(
        {
          prefs: allOn(),
          channels,
          events: [...ADMIN_NOTIFY_EVENT_KEYS],
        },
        "req-1",
        undefined,
      ),
    );
    // Must not snap back to defaults while save is in flight.
    expect(state.prefs?.email.purchase_enrollment).toBe(false);
    expect(state.prefsSaving).toBe(true);
  });
});
