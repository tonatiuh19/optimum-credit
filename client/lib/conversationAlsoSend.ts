export type AlsoRecipient = {
  key: string;
  phone: string;
  label: string;
};

/**
 * Dedupe key for also-send recipients.
 * US/Canada NANP → last 10 digits; international keeps full digit string.
 */
export function phoneDedupeKey(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return d.slice(-10);
  if (d.length === 10) return d;
  return d;
}

/** Dedupe also-send recipients by normalized phone key. */
export function dedupeAlsoRecipients(
  recipients: AlsoRecipient[],
): AlsoRecipient[] {
  const seen = new Set<string>();
  const out: AlsoRecipient[] = [];
  for (const r of recipients) {
    const key = phoneDedupeKey(r.phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Keep only recipients whose labels failed (for retry after partial fan-out). */
export function filterAlsoRecipientsForRetry(
  recipients: AlsoRecipient[],
  failedLabels: string[],
): AlsoRecipient[] {
  const failed = new Set(failedLabels);
  return recipients.filter((r) => failed.has(r.label));
}
