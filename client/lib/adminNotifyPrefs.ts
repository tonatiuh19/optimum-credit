import type {
  AdminNotificationPrefs,
  AdminNotifyChannel,
  AdminNotifyEventKey,
  AdminNotifyEventToggles,
} from "@shared/api";

/** Keep in sync with api/index.ts ADMIN_NOTIFY_EVENT_KEYS. */
export const ADMIN_NOTIFY_EVENT_KEYS: AdminNotifyEventKey[] = [
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

export type AdminNotifyPrefsPatch = {
  channel_masters?: Partial<Record<AdminNotifyChannel, boolean>>;
  email?: Partial<Record<AdminNotifyEventKey, boolean>>;
  in_app?: Partial<Record<AdminNotifyEventKey, boolean>>;
  sms?: Partial<Record<AdminNotifyEventKey, boolean>>;
};

function cloneToggles(t: AdminNotifyEventToggles): AdminNotifyEventToggles {
  return { ...t };
}

function applyChannelMaster(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
  value: boolean,
): void {
  const next = cloneToggles(prefs[channel]);
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) {
    next[key] = value;
  }
  prefs[channel] = next;
}

/**
 * Apply a prefs patch the same way the API merges writes.
 * Used for optimistic UI so controlled switches do not snap back On
 * while the PUT is in flight.
 */
export function applyAdminNotifyPrefsPatch(
  current: AdminNotificationPrefs,
  patch: AdminNotifyPrefsPatch,
): AdminNotificationPrefs {
  const next: AdminNotificationPrefs = {
    email: cloneToggles(current.email),
    in_app: cloneToggles(current.in_app),
    sms: cloneToggles(current.sms),
  };
  if (patch.channel_masters) {
    if (typeof patch.channel_masters.email === "boolean") {
      applyChannelMaster(next, "email", patch.channel_masters.email);
    }
    if (typeof patch.channel_masters.in_app === "boolean") {
      applyChannelMaster(next, "in_app", patch.channel_masters.in_app);
    }
    if (typeof patch.channel_masters.sms === "boolean") {
      applyChannelMaster(next, "sms", patch.channel_masters.sms);
    }
  }
  if (patch.email) next.email = { ...next.email, ...patch.email };
  if (patch.in_app) next.in_app = { ...next.in_app, ...patch.in_app };
  if (patch.sms) next.sms = { ...next.sms, ...patch.sms };
  return next;
}

/** Master switch is On when any event on that channel is On. */
export function adminNotifyChannelMasterOn(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
): boolean {
  const toggles = prefs[channel];
  return ADMIN_NOTIFY_EVENT_KEYS.some((k) => toggles[k]);
}
