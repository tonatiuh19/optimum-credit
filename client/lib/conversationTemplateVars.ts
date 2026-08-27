import type { ConversationTemplate } from "@shared/api";

/** Variables available in Conversations composer (type `{{` to insert). */
export const CONVERSATION_TEMPLATE_VARS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "full_name", label: "Full name" },
  { key: "phone", label: "Phone" },
  { key: "pipeline_stage", label: "Pipeline stage" },
  { key: "client_status", label: "Client status" },
  { key: "portal_url", label: "Portal URL" },
] as const;

/** Compact chips under the composer (keep short — avoids wrapping the Send button). */
export const CONVERSATION_COMPOSER_QUICK_VARS = [
  "first_name",
  "phone",
  "portal_url",
] as const satisfies ReadonlyArray<
  (typeof CONVERSATION_TEMPLATE_VARS)[number]["key"]
>;

export type ConversationVarKey =
  (typeof CONVERSATION_TEMPLATE_VARS)[number]["key"];

export type ConversationMergeContext = Partial<
  Record<ConversationVarKey, string | null | undefined>
> & {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  pipeline_stage?: string | null;
  client_status?: string | null;
  portal_url?: string | null;
};

export function buildConversationMergeVars(
  ctx: ConversationMergeContext,
  appUrl = "",
): Record<string, string> {
  const first = String(ctx.first_name || "").trim();
  const last = String(ctx.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  return {
    first_name: first || "there",
    last_name: last,
    full_name: full || first || "there",
    phone: String(ctx.phone || "").trim(),
    pipeline_stage: String(ctx.pipeline_stage || "").trim(),
    client_status: String(ctx.client_status || "").trim(),
    portal_url:
      String(ctx.portal_url || "").trim() ||
      (appUrl ? `${appUrl.replace(/\/$/, "")}/portal` : "{{portal_url}}"),
  };
}

export function applyConversationTemplateVars(
  text: string,
  vars: Record<string, string>,
): string {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] != null && vars[key] !== "" ? vars[key] : `{{${key}}}`,
  );
}

export function applyConversationTemplate(
  template: Pick<ConversationTemplate, "subject" | "body">,
  vars: Record<string, string>,
): { subject: string; body: string } {
  return {
    subject: applyConversationTemplateVars(template.subject || "", vars),
    body: applyConversationTemplateVars(template.body || "", vars),
  };
}

/** Detect `{{partial` at cursor for suggestion picker. */
export function getOpenVariableToken(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/\{\{([a-zA-Z0-9_]*)$/);
  if (!m) return null;
  return { start: cursor - m[0].length, query: m[1] || "" };
}
