/**
 * True when a call-forwarding number is outside the US/Canada (+1). Those
 * calls need the destination country enabled in Twilio geo permissions,
 * otherwise every forwarded call fails (Twilio 13227) and shows as missed.
 */
export function isInternationalForwardingNumber(
  raw: string | null | undefined,
): boolean {
  const v = String(raw || "").trim();
  if (!v.startsWith("+")) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length > 0 && !digits.startsWith("1");
}
