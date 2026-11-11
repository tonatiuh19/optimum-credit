export type AlsoRecipient = {
  key: string;
  phone: string;
  label: string;
  /** Another client owns this phone, so the copy lands in their thread. */
  phoneClientName?: string;
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

const stripAccents = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const GREETING =
  "(?:hi|hello|hey|hola|dear|estimad[oa]|querid[oa]|saludos|buen[oa]s(?:\\s+(?:dias|tardes|noches))?|good\\s+(?:morning|afternoon|evening))";

const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when a message is written to the client personally, so an exact copy
 * to someone else would greet them with the wrong name. Counts a name merge
 * field, or the client's first name used as a greeting ("Hi Carlos",
 * "Hello! Julianna") or as a direct address ("Carlos, …"). A name that only
 * appears mid-sentence ("Will you…", "we spoke with Rosa") doesn't count.
 */
export function messageAddressesClient(
  rawBody: string,
  clientFirstName: string | null | undefined,
): boolean {
  const body = String(rawBody || "");
  if (/\{\{\s*(first_name|last_name|full_name)\s*\}\}/.test(body)) return true;
  const first = stripAccents(String(clientFirstName || "").trim().split(/\s+/)[0] || "");
  if (first.length < 2) return false;
  const text = stripAccents(body);
  const name = `(?<![\\p{L}\\p{N}])${escapeRegExp(first)}(?![\\p{L}\\p{N}])`;
  const greeted = new RegExp(`(?<![\\p{L}])${GREETING}[\\s!,.:;-]+${name}`, "u");
  const addressed = new RegExp(`(?:^|[.!?¡¿]\\s*)${name}\\s*[,!:]`, "u");
  return greeted.test(text) || addressed.test(text);
}
