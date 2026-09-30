import { parseComposePhoneInput } from "@/lib/parseComposePhone";

export type ContactPhoneActionTarget = {
  /** Display / dial string (raw or E.164). */
  phone: string;
  clientId?: number | null;
  clientName?: string | null;
  /** CRM contacts.id (independent address-book contact). */
  contactId?: number | null;
  contactName?: string | null;
};

/** Normalize a displayed phone for Call / Text when possible. */
export function normalizeContactPhone(
  raw: string | null | undefined,
): { phone: string; label: string } | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const parsed = parseComposePhoneInput(trimmed);
  if (parsed) return parsed;
  // Allow short / partial display numbers through for Call (Twilio may still reject).
  return { phone: trimmed, label: trimmed };
}

/**
 * Deep link into Conversations "New message" compose with a prefilled recipient.
 * Used by ContactPhoneActions Text from anywhere in admin.
 */
export function buildComposeDeepLink(opts: {
  phone?: string | null;
  clientId?: number | null;
  /** Prefill compose with a CRM contact (XOR with client when possible). */
  contactId?: number | null;
}): string | null {
  const params = new URLSearchParams();
  const clientId =
    opts.clientId != null && Number(opts.clientId) > 0
      ? Number(opts.clientId)
      : null;
  const contactId =
    opts.contactId != null && Number(opts.contactId) > 0
      ? Number(opts.contactId)
      : null;
  const normalized = opts.phone ? normalizeContactPhone(opts.phone) : null;

  if (clientId) params.set("composeClient", String(clientId));
  if (contactId && !clientId) params.set("composeContact", String(contactId));
  if (normalized?.phone) params.set("composePhone", normalized.phone);

  if (![...params.keys()].length) return null;
  return `/admin/conversations?${params.toString()}`;
}
