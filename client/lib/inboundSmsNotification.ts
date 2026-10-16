import type { AdminNotificationPrefs, AdminNotifyEventKey } from "@shared/api";

/** Legacy default: null prefs = all channels ON (matches API). */
export function isInboundSmsInAppEnabled(
  prefs: AdminNotificationPrefs | null | undefined,
): boolean {
  if (!prefs) return true;
  return prefs.in_app.inbound_sms !== false;
}

/** Chime only when local sound is on and in-app inbound SMS alerts are enabled. */
export function shouldPlayInboundSmsChime(
  prefs: AdminNotificationPrefs | null | undefined,
  soundMuted: boolean,
): boolean {
  if (soundMuted) return false;
  return isInboundSmsInAppEnabled(prefs);
}

const VOICE_CHIME_EVENTS: AdminNotifyEventKey[] = [
  "missed_call",
  "voicemail",
  "call_transcript",
];

/** Whether an Ably bell event should play the notification chime. */
export function shouldPlayAdminNotifyChime(
  eventKey: string | undefined,
  prefs: AdminNotificationPrefs | null | undefined,
  soundMuted: boolean,
): boolean {
  if (soundMuted || !eventKey) return false;
  if (eventKey === "inbound_sms") {
    return isInboundSmsInAppEnabled(prefs);
  }
  if (!(VOICE_CHIME_EVENTS as string[]).includes(eventKey)) return false;
  if (!prefs) return true;
  const key = eventKey as AdminNotifyEventKey;
  return prefs.in_app[key] !== false;
}
