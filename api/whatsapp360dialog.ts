/**
 * Pure helpers for 360dialog WhatsApp Cloud API (unit-tested).
 * Runtime fetch / DB I/O stays inline in api/index.ts (Vercel monolith).
 *
 * Gates (default OFF — no behavior change until enabled):
 *   WHATSAPP_360DIALOG_ENABLED=1
 *   D360_API_KEY=<360dialog API key>
 * Optional:
 *   WHATSAPP_ASSIGNED_ADMIN_ID=<admins.id>  (else resolve César by profile phone)
 *   WHATSAPP_360DIALOG_VERIFY_TOKEN=<hub.verify_token for GET webhook>
 *
 * Default assignee phone (César profile): (951) 378-3429 → last10 9513783429
 */

export const WHATSAPP_360_API_BASE = "https://waba-v2.360dialog.io";
export const WHATSAPP_MAX_BODY_CHARS = 4096;
/** César's staff profile phone — used when WHATSAPP_ASSIGNED_ADMIN_ID unset. */
export const WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10 = "9513783429";

export function envFlagOn(raw: string | undefined | null): boolean {
  const v = String(raw ?? "0")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function whatsapp360dialogApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return String(env.D360_API_KEY || "").trim();
}

/** Flag on + API key present. */
export function whatsapp360dialogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    envFlagOn(env.WHATSAPP_360DIALOG_ENABLED) && !!whatsapp360dialogApiKey(env)
  );
}

export function whatsapp360dialogVerifyToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return String(env.WHATSAPP_360DIALOG_VERIFY_TOKEN || "").trim();
}

/** Strip to digits for Cloud API `to` / wa_id compare. */
export function whatsappDigits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/** Prefer +E.164 for US 11-digit (1…) or as-is with + when already international. */
export function whatsappToE164(raw: string | null | undefined): string {
  const digits = whatsappDigits(raw);
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export type Whatsapp360InboundMessage = {
  providerMessageId: string;
  fromWaId: string;
  fromE164: string;
  type: string;
  textBody: string;
  timestamp?: string;
  profileName?: string | null;
};

export type Whatsapp360StatusUpdate = {
  providerMessageId: string;
  status: string;
  recipientId?: string;
  errors?: string | null;
};

export type Whatsapp360ParsedWebhook = {
  messages: Whatsapp360InboundMessage[];
  statuses: Whatsapp360StatusUpdate[];
};

function inboundBodyFromMessage(msg: Record<string, unknown>): {
  type: string;
  textBody: string;
} {
  const type = String(msg.type || "unknown");
  if (type === "text") {
    const text = msg.text as { body?: string } | undefined;
    return { type, textBody: String(text?.body || "") };
  }
  if (type === "button") {
    const button = msg.button as { text?: string; payload?: string } | undefined;
    return {
      type,
      textBody: String(button?.text || button?.payload || "[button]"),
    };
  }
  if (type === "interactive") {
    const interactive = msg.interactive as
      | {
          type?: string;
          button_reply?: { title?: string };
          list_reply?: { title?: string };
        }
      | undefined;
    const title =
      interactive?.button_reply?.title ||
      interactive?.list_reply?.title ||
      interactive?.type ||
      "interactive";
    return { type, textBody: String(title) };
  }
  // Image/audio/doc/sticker/location — placeholder until media fetch lands.
  return { type, textBody: `[${type}]` };
}

/**
 * Parse Meta Cloud API–compatible webhook body from 360dialog.
 * Ignores non-messages fields; safe on malformed payloads.
 */
export function parseWhatsapp360WebhookPayload(
  body: unknown,
): Whatsapp360ParsedWebhook {
  const messages: Whatsapp360InboundMessage[] = [];
  const statuses: Whatsapp360StatusUpdate[] = [];
  const root = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<Record<string, unknown>>;
          statuses?: Array<Record<string, unknown>>;
          contacts?: Array<{
            wa_id?: string;
            profile?: { name?: string };
          }>;
        };
      }>;
    }>;
  };
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const nameByWa = new Map<string, string>();
      for (const c of contacts) {
        const wa = whatsappDigits(c?.wa_id);
        const name = String(c?.profile?.name || "").trim();
        if (wa && name) nameByWa.set(wa, name);
      }
      const msgs = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of msgs) {
        const fromWaId = whatsappDigits(String(msg.from || ""));
        if (!fromWaId) continue;
        const providerMessageId = String(msg.id || "").trim();
        if (!providerMessageId) continue;
        const { type, textBody } = inboundBodyFromMessage(msg);
        messages.push({
          providerMessageId,
          fromWaId,
          fromE164: whatsappToE164(fromWaId),
          type,
          textBody,
          timestamp: msg.timestamp != null ? String(msg.timestamp) : undefined,
          profileName: nameByWa.get(fromWaId) || null,
        });
      }
      const sts = Array.isArray(value.statuses) ? value.statuses : [];
      for (const st of sts) {
        const providerMessageId = String(st.id || "").trim();
        if (!providerMessageId) continue;
        const status = String(st.status || "").trim().toLowerCase();
        const errors = Array.isArray(st.errors)
          ? JSON.stringify(st.errors).slice(0, 500)
          : null;
        statuses.push({
          providerMessageId,
          status,
          recipientId: st.recipient_id != null ? String(st.recipient_id) : undefined,
          errors,
        });
      }
    }
  }
  return { messages, statuses };
}

/** Map Cloud API status → conversation_messages.provider_status. */
export function mapWhatsapp360ProviderStatus(status: string): string {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "sent" || s === "delivered" || s === "read" || s === "failed") {
    return s;
  }
  if (s === "accepted" || s === "queued") return "accepted";
  return s || "unknown";
}

export function whatsappBodyWithinLimit(
  body: string,
  max = WHATSAPP_MAX_BODY_CHARS,
): boolean {
  return [...String(body || "")].length <= max;
}
