/** Twilio terminal states — stop polling once reached. */
const TERMINAL_OUTBOUND = new Set([
  "delivered",
  "failed",
  "undelivered",
  "canceled",
  "cancelled",
]);

/** Outbound SMS/MMS still in flight (queued → delivered). */
export function isOutboundProviderStatusPending(
  direction: string,
  providerStatus?: string | null,
): boolean {
  if (direction !== "outbound") return false;
  const s = String(providerStatus || "").trim().toLowerCase();
  if (!s) return true;
  return !TERMINAL_OUTBOUND.has(s);
}
