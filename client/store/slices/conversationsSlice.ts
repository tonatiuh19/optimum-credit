import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import { decodeLiteralUnicodeEscapes } from "@/lib/decodeLiteralUnicodeEscapes";
import type {
  AdminPhoneNumber,
  AdminConversationsListResponse,
  ConversationContactHubItem,
  ConversationMessage,
  ConversationTemplate,
} from "@shared/api";

export type ConversationsView =
  | "all"
  | "mine"
  | "unassigned"
  | "open"
  | "closed"
  | "unread"
  | "unknown";

const CONTACTS_PAGE_SIZE = 25;

function contactKey(c: { kind: string; contact_id: number }) {
  return `${c.kind}:${c.contact_id}`;
}

/** Normalize list rows (unicode escapes in previews, etc.). */
export function mapConversationContact(
  c: ConversationContactHubItem,
): ConversationContactHubItem {
  return {
    ...c,
    last_message_preview: c.last_message_preview
      ? decodeLiteralUnicodeEscapes(String(c.last_message_preview))
      : c.last_message_preview,
  };
}

export interface ConversationTimelineThread {
  id: number;
  channel: string;
  status: string;
  assigned_admin_id?: number | null;
  ofg_number_id?: number | null;
  unread_count?: number;
  last_message_at?: string | null;
}

export interface ConversationTimeline {
  kind: "client" | "unknown" | "contact" | "contact";
  contact: Record<string, unknown>;
  threads?: ConversationTimelineThread[];
  messages: ConversationMessage[];
}

interface ConversationsState {
  accessEnabled: boolean | null;
  accessNumbers: AdminPhoneNumber[];
  accessLoading: boolean;
  contacts: ConversationContactHubItem[];
  contactsPagination: AdminConversationsListResponse["pagination"] | null;
  contactsLoading: boolean;
  /** Background inbox refresh — soft opacity, never skeleton. */
  contactsRefreshing: boolean;
  contactsLoadedOnce: boolean;
  contactsError: string | null;
  view: ConversationsView;
  search: string;
  activeKind: "client" | "unknown" | "contact" | null;
  activeId: number | null;
  /** Conversation hub status for the open panel (survives list filter removes). */
  activeHubStatus: ConversationContactHubItem["status"] | null;
  timeline: ConversationTimeline | null;
  timelineLoading: boolean;
  timelineRefreshing: boolean;
  /** `${kind}:${id}` of the last successful timeline fetch. */
  timelineLoadedKey: string | null;
  sending: boolean;
  sendError: string | null;
  phoneNumbers: AdminPhoneNumber[];
  phoneNumbersLoading: boolean;
  ablyTokenRequest: unknown | null;
  templates: ConversationTemplate[];
  templatesLoading: boolean;
  navBadgeUnread: number;
  navBadgeLoading: boolean;
  aiSuggestionsLoading: boolean;
  aiSuggestions: Array<{ id: string; label: string; body: string }>;
  retryCallInsightsId: number | null;
}

const initialState: ConversationsState = {
  accessEnabled: null,
  accessNumbers: [],
  accessLoading: false,
  contacts: [],
  contactsPagination: null,
  contactsLoading: false,
  contactsRefreshing: false,
  contactsLoadedOnce: false,
  contactsError: null,
  view: "all",
  search: "",
  activeKind: null,
  activeId: null,
  activeHubStatus: null,
  timeline: null,
  timelineLoading: false,
  timelineRefreshing: false,
  timelineLoadedKey: null,
  sending: false,
  sendError: null,
  phoneNumbers: [],
  phoneNumbersLoading: false,
  ablyTokenRequest: null,
  templates: [],
  templatesLoading: false,
  navBadgeUnread: 0,
  navBadgeLoading: false,
  aiSuggestionsLoading: false,
  aiSuggestions: [],
  retryCallInsightsId: null,
};

/** Maps API timeline rows into hub messages (includes call recording fields). */
export function mapConversationHubMessage(m: any): ConversationMessage {
  let meta: Record<string, unknown> | null = null;
  try {
    if (m.metadata_json) {
      meta =
        typeof m.metadata_json === "string"
          ? JSON.parse(m.metadata_json)
          : (m.metadata_json as Record<string, unknown>);
    }
  } catch {
    meta = null;
  }
  const subject =
    (meta?.subject as string | undefined) || m.subject || null;
  const channel = String(m.channel || "sms");
  const isSystem =
    String(m.direction || "") === "system" || meta?.system_event === true;
  const direction: ConversationMessage["direction"] = isSystem
    ? "system"
    : channel === "internal"
      ? "internal"
      : (m.direction as ConversationMessage["direction"]);
  return {
    id: Number(m.id),
    conversation_id: m.conversation_id != null ? Number(m.conversation_id) : undefined,
    direction,
    channel,
    body: decodeLiteralUnicodeEscapes(String(m.body || "")),
    media_url: m.media_url ? String(m.media_url) : null,
    media_content_type: m.media_content_type
      ? String(m.media_content_type)
      : null,
    subject,
    from_address: m.from_address ?? null,
    to_address: m.to_address ?? null,
    sent_by_admin_id:
      m.sent_by_admin_id != null ? Number(m.sent_by_admin_id) : null,
    sent_by_admin_name: m.sent_by_admin_name ?? null,
    provider_message_id: m.provider_message_id ?? null,
    provider_status: m.provider_status ?? null,
    error_message: m.error_message ?? null,
    call_duration_sec:
      m.call_duration_sec != null ? Number(m.call_duration_sec) : null,
    recording_url: m.recording_url ? String(m.recording_url) : null,
    metadata_json: meta,
    call_insights_status: m.call_insights_status
      ? (String(m.call_insights_status) as ConversationMessage["call_insights_status"])
      : null,
    call_insights_error: m.call_insights_error
      ? String(m.call_insights_error)
      : null,
    call_transcript: m.call_transcript
      ? decodeLiteralUnicodeEscapes(String(m.call_transcript))
      : null,
    call_insights_json: (() => {
      if (!m.call_insights_json) return null;
      try {
        const raw =
          typeof m.call_insights_json === "string"
            ? JSON.parse(m.call_insights_json)
            : m.call_insights_json;
        return raw && typeof raw === "object" ? raw : null;
      } catch {
        return null;
      }
    })(),
    created_at: String(m.created_at),
  };
}

function mapMessage(m: any): ConversationMessage {
  return mapConversationHubMessage(m);
}

export function mapConversationTemplate(
  t: ConversationTemplate,
): ConversationTemplate {
  return {
    ...t,
    subject: t.subject
      ? decodeLiteralUnicodeEscapes(String(t.subject))
      : t.subject,
    body: decodeLiteralUnicodeEscapes(String(t.body || "")),
  };
}

export const fetchConversationsAccess = createAsyncThunk(
  "conversations/access",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/admin/conversations/access");
      return data as { enabled: boolean; numbers: AdminPhoneNumber[] };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to check access"));
    }
  },
);

export const fetchConversationsNavBadge = createAsyncThunk(
  "conversations/navBadge",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get<{ unread_total: number }>(
        "/admin/conversations/badge",
      );
      return Number(data.unread_total || 0);
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load badge"));
    }
  },
);

export const fetchConversationContacts = createAsyncThunk(
  "conversations/contacts",
  async (
    args:
      | {
          view?: ConversationsView;
          q?: string;
          page?: number;
          limit?: number;
          /** Append page to existing list (Load more). */
          append?: boolean;
        }
      | undefined,
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.get("/admin/conversations", {
        params: {
          view: args?.view || "all",
          q: args?.q || undefined,
          page: args?.page || 1,
          limit: args?.limit || CONTACTS_PAGE_SIZE,
        },
      });
      return {
        ...(data as AdminConversationsListResponse),
        contacts: (data.contacts || []).map(mapConversationContact),
        append: !!args?.append,
      };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load inbox"));
    }
  },
);

export const fetchConversationTimeline = createAsyncThunk(
  "conversations/timeline",
  async (
    args: { kind: "client" | "unknown" | "contact" | "contact"; id: number },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.get(
        `/admin/conversations/contact/${args.kind}/${args.id}/timeline`,
      );
      return {
        kind: data.kind as "client" | "unknown" | "contact",
        contact: data.contact || {},
        threads: data.threads || [],
        messages: (data.messages || []).map(mapMessage),
      } as ConversationTimeline;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load timeline"));
    }
  },
);

export const sendHubMessage = createAsyncThunk(
  "conversations/send",
  async (
    args: {
      client_id?: number;
      unknown_contact_id?: number;
      contact_id?: number;
      channel: "sms" | "internal";
      body: string;
      subject?: string;
      is_internal_note?: boolean;
      ofg_number_id?: number;
      media_url?: string;
      media_content_type?: string;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post("/admin/conversations/send", args);
      if (data.error) {
        return rejectWithValue(String(data.error));
      }
      return data as {
        ok: boolean;
        conversation_id: number;
        message_id: number;
        provider_status?: string | null;
        error?: string | null;
        client_id?: number;
        unknown_contact_id?: number;
        contact_id?: number;
      };
    } catch (e: any) {
      if (e?.response?.data?.error === "conversation_closed") {
        return rejectWithValue("conversation_closed");
      }
      return rejectWithValue(formatAxiosError(e, "Failed to send"));
    }
  },
);

export const startConversationOutbound = createAsyncThunk(
  "conversations/startOutbound",
  async (
    args: {
      phone: string;
      body: string;
      ofg_number_id?: number;
      media_url?: string;
      media_content_type?: string;
      channel?: "sms" | "internal";
      is_internal_note?: boolean;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post("/admin/conversations/start", args);
      if (data.error) {
        return rejectWithValue(String(data.error));
      }
      return data as {
        ok: boolean;
        kind: "client" | "unknown" | "contact";
        client_id?: number;
        unknown_contact_id?: number;
        contact_id?: number;
        unknown_created?: boolean;
        phone?: string;
        conversation_id: number;
        message_id: number;
        provider_status?: string | null;
        error?: string | null;
      };
    } catch (e: any) {
      if (e?.response?.data?.error === "conversation_closed") {
        return rejectWithValue("conversation_closed");
      }
      return rejectWithValue(formatAxiosError(e, "Failed to start conversation"));
    }
  },
);

export const fetchConversationAiSuggestions = createAsyncThunk(
  "conversations/aiSuggestions",
  async (
    args: {
      kind: "client" | "unknown" | "contact";
      contact_id: number;
      recent_messages: Array<{ direction: string; body: string | null }>;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post("/admin/conversations/suggest-replies", {
        ...args,
        include_ai: true,
      });
      return (data.ai_suggestions || []).map(
        (s: { id: string; label: string; body: string }) => ({
          ...s,
          label: decodeLiteralUnicodeEscapes(String(s.label || "")),
          body: decodeLiteralUnicodeEscapes(String(s.body || "")),
        }),
      ) as Array<{
        id: string;
        label: string;
        body: string;
      }>;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load suggestions"));
    }
  },
);

export const uploadConversationMedia = createAsyncThunk(
  "conversations/uploadMedia",
  async (file: File, { rejectWithValue }) => {
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(
        "/admin/conversations/media/upload",
        form,
      );
      return data as {
        success: boolean;
        url: string;
        content_type: string;
        filename: string;
        cdn_url?: string | null;
      };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to upload media"));
    }
  },
);

export const retryCallInsights = createAsyncThunk(
  "conversations/retryCallInsights",
  async (args: { messageId: number }, { rejectWithValue }) => {
    try {
      const { data } = await api.post(
        `/admin/conversations/messages/${args.messageId}/retry-call-insights`,
      );
      return {
        messageId: args.messageId,
        message: data?.message
          ? mapConversationHubMessage(data.message)
          : null,
      };
    } catch (e: any) {
      return rejectWithValue(
        formatAxiosError(e, "Failed to retry call insights"),
      );
    }
  },
);

export const assignConversationContact = createAsyncThunk(
  "conversations/assign",
  async (
    args: { clientId: number; assigned_admin_id?: number | null },
    { rejectWithValue },
  ) => {
    try {
      await api.post(
        `/admin/conversations/contact/client/${args.clientId}/assign`,
        { assigned_admin_id: args.assigned_admin_id ?? undefined },
      );
      return args;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to assign"));
    }
  },
);

export const setConversationContactStatus = createAsyncThunk(
  "conversations/status",
  async (
    args: {
      kind: "client" | "unknown" | "contact" | "contact";
      contactId: number;
      status: "open" | "snoozed" | "closed" | "archived";
    },
    { rejectWithValue, getState },
  ) => {
    try {
      const path =
        args.kind === "unknown"
          ? `/admin/conversations/unknown/${args.contactId}/status`
          : args.kind === "contact"
            ? `/admin/conversations/contact/${args.contactId}/status`
            : `/admin/conversations/contact/client/${args.contactId}/status`;
      const { data } = await api.post(path, { status: args.status });
      const view = (getState() as { conversations: ConversationsState })
        .conversations.view;
      return {
        ...args,
        status: (data?.status as typeof args.status) || args.status,
        system_message: data?.system_message
          ? mapConversationHubMessage(data.system_message)
          : null,
        contact: data?.contact as Partial<ConversationContactHubItem> | null,
        view,
      };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to update status"));
    }
  },
);

export const linkUnknownContact = createAsyncThunk(
  "conversations/linkUnknown",
  async (
    args: { unknownId: number; client_id: number },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post(
        `/admin/conversations/unknown/${args.unknownId}/link`,
        { client_id: args.client_id },
      );
      return data as { ok: boolean; client_id: number };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to link"));
    }
  },
);

export const createProspectFromUnknown = createAsyncThunk(
  "conversations/createProspect",
  async (
    args: {
      unknownId: number;
      first_name?: string;
      last_name?: string;
      email?: string;
      preferred_language?: "en" | "es";
      create_case?: boolean;
      confirm_duplicate?: boolean;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post(
        `/admin/conversations/unknown/${args.unknownId}/create-prospect`,
        {
          first_name: args.first_name,
          last_name: args.last_name,
          email: args.email,
          preferred_language: args.preferred_language,
          create_case: args.create_case,
          confirm_duplicate: args.confirm_duplicate,
        },
      );
      return data as {
        ok: boolean;
        client_id: number;
        case_id?: number | null;
        preferred_language?: string;
      };
    } catch (e: any) {
      const err = e?.response?.data;
      if (err?.error === "duplicate_phone") {
        return rejectWithValue(
          JSON.stringify({ code: "duplicate_phone", duplicates: err.duplicates }),
        );
      }
      return rejectWithValue(formatAxiosError(e, "Failed to create prospect"));
    }
  },
);

export const dismissUnknownContact = createAsyncThunk(
  "conversations/dismissUnknown",
  async (unknownId: number, { rejectWithValue }) => {
    try {
      await api.post(`/admin/conversations/unknown/${unknownId}/dismiss`);
      return unknownId;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to dismiss"));
    }
  },
);

export const fetchAdminPhoneNumbers = createAsyncThunk(
  "conversations/phoneNumbers",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/admin/phone-numbers");
      return (data.numbers || []) as AdminPhoneNumber[];
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load numbers"));
    }
  },
);

export const syncAdminPhoneNumbersFromTwilio = createAsyncThunk(
  "conversations/syncPhoneNumbers",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{
        ok: boolean;
        upserted: number;
        numbers: AdminPhoneNumber[];
      }>("/admin/phone-numbers/sync-twilio");
      return {
        upserted: Number(data.upserted || 0),
        numbers: (data.numbers || []) as AdminPhoneNumber[],
      };
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to sync from Twilio"));
    }
  },
);

export const assignAdminPhoneNumber = createAsyncThunk(
  "conversations/assignPhone",
  async (
    args: { id: number; assigned_admin_id: number | null },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.patch(`/admin/phone-numbers/${args.id}`, {
        assigned_admin_id: args.assigned_admin_id,
      });
      return data.number as AdminPhoneNumber;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to assign number"));
    }
  },
);

export const fetchConversationsAblyToken = createAsyncThunk(
  "conversations/ablyToken",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/admin/me/ably-token");
      return data.tokenRequest;
    } catch (e: any) {
      // Optional realtime — soft-fail
      return rejectWithValue(formatAxiosError(e, "ably unavailable"));
    }
  },
);

export const fetchConversationTemplates = createAsyncThunk(
  "conversations/templates",
  async (
    args: { channel?: string; all?: boolean } | void,
    { rejectWithValue },
  ) => {
    try {
      const opts = args || {};
      const { data } = await api.get("/admin/conversation-templates", {
        params: {
          channel: opts.channel || undefined,
          all: opts.all ? "1" : undefined,
        },
      });
      return (data.templates || []).map(mapConversationTemplate) as ConversationTemplate[];
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to load templates"));
    }
  },
);

export const createConversationTemplate = createAsyncThunk(
  "conversations/createTemplate",
  async (
    args: {
      name: string;
      channel: "sms" | "internal";
      subject?: string | null;
      body: string;
      variables?: string[];
      sort_order?: number;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post("/admin/conversation-templates", args);
      return mapConversationTemplate(data.template as ConversationTemplate);
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to create template"));
    }
  },
);

export const updateConversationTemplate = createAsyncThunk(
  "conversations/updateTemplate",
  async (
    args: {
      id: number;
      name?: string;
      channel?: "sms" | "internal";
      subject?: string | null;
      body?: string;
      variables?: string[];
      is_active?: boolean;
      sort_order?: number;
    },
    { rejectWithValue },
  ) => {
    try {
      const { id, ...rest } = args;
      const { data } = await api.patch(
        `/admin/conversation-templates/${id}`,
        rest,
      );
      return mapConversationTemplate(data.template as ConversationTemplate);
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to update template"));
    }
  },
);

export const deleteConversationTemplate = createAsyncThunk(
  "conversations/deleteTemplate",
  async (id: number, { rejectWithValue }) => {
    try {
      await api.delete(`/admin/conversation-templates/${id}`);
      return id;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to delete template"));
    }
  },
);

const slice = createSlice({
  name: "conversations",
  initialState,
  reducers: {
    setConversationsView(state, action: { payload: ConversationsView }) {
      state.view = action.payload;
    },
    setConversationsSearch(state, action: { payload: string }) {
      state.search = action.payload;
    },
    clearActiveConversation(state) {
      state.activeKind = null;
      state.activeId = null;
      state.activeHubStatus = null;
      state.timeline = null;
      state.timelineLoadedKey = null;
    },
    selectConversationContact(
      state,
      action: {
        payload: {
          kind: "client" | "unknown" | "contact";
          id: number;
          status?: ConversationContactHubItem["status"];
        };
      },
    ) {
      state.activeKind = action.payload.kind;
      state.activeId = action.payload.id;
      if (action.payload.status) {
        state.activeHubStatus = action.payload.status;
      } else {
        const found = state.contacts.find(
          (c) =>
            c.kind === action.payload.kind &&
            c.contact_id === action.payload.id,
        );
        state.activeHubStatus = found?.status ?? "open";
      }
    },
    setConversationsSendError(state, action: { payload: string | null }) {
      state.sendError = action.payload;
    },

    /** Merge Ably inbox patch in-place — bubble to top; insert if new (real-state). */
    contactActivityRealtime(
      state,
      action: {
        payload: {
          kind: "client" | "unknown" | "contact";
          contact_id: number;
          patch: Partial<ConversationContactHubItem>;
        };
      },
    ) {
      const { kind, contact_id, patch } = action.payload;
      const normalizedPatch = {
        ...patch,
        ...(patch.last_message_preview != null
          ? {
              last_message_preview: decodeLiteralUnicodeEscapes(
                String(patch.last_message_preview),
              ),
            }
          : {}),
      };
      const status = normalizedPatch.status as
        | ConversationContactHubItem["status"]
        | undefined;
      const isClosed = status === "closed" || status === "archived";
      const viewHidesClosed =
        state.view === "mine" ||
        state.view === "all" ||
        state.view === "open" ||
        state.view === "unassigned" ||
        state.view === "unread" ||
        state.view === "unknown";
      const viewHidesOpen = state.view === "closed";

      const idx = state.contacts.findIndex(
        (c) => c.kind === kind && c.contact_id === contact_id,
      );
      if (idx >= 0) {
        const updated = { ...state.contacts[idx], ...normalizedPatch };
        if (normalizedPatch.last_message_at) {
          state.contacts.splice(idx, 1);
          state.contacts.unshift(updated);
        } else {
          state.contacts[idx] = updated;
        }
        if (
          state.activeKind === kind &&
          state.activeId === contact_id &&
          status
        ) {
          state.activeHubStatus = status;
        }
        // Drop from filtered lists after status change (match local status fulfilled).
        if (status) {
          const i2 = state.contacts.findIndex(
            (c) => c.kind === kind && c.contact_id === contact_id,
          );
          if (
            i2 >= 0 &&
            ((isClosed && viewHidesClosed) || (!isClosed && viewHidesOpen))
          ) {
            state.contacts.splice(i2, 1);
          }
        }
        return;
      }
      if (status && ((isClosed && viewHidesClosed) || (!isClosed && viewHidesOpen))) {
        // Don't insert into a filter that wouldn't show this status.
        if (
          state.activeKind === kind &&
          state.activeId === contact_id &&
          status
        ) {
          state.activeHubStatus = status;
        }
        return;
      }
      const inserted: ConversationContactHubItem = {
        kind,
        contact_id,
        display_name:
          String(normalizedPatch.display_name || "").trim() || "Contact",
        phone: normalizedPatch.phone ?? null,
        email: normalizedPatch.email ?? null,
        last_message_at: normalizedPatch.last_message_at ?? null,
        last_message_preview: normalizedPatch.last_message_preview ?? null,
        unread_count: Number(normalizedPatch.unread_count ?? 1),
        status:
          (normalizedPatch.status as ConversationContactHubItem["status"]) ||
          "open",
        assigned_admin_id: normalizedPatch.assigned_admin_id ?? null,
        assigned_admin_name: normalizedPatch.assigned_admin_name ?? null,
        channels: normalizedPatch.channels ?? ["sms"],
        primary_conversation_id:
          normalizedPatch.primary_conversation_id ?? null,
        client_id:
          kind === "client"
            ? contact_id
            : normalizedPatch.client_id ?? null,
        unknown_contact_id:
          kind === "unknown"
            ? contact_id
            : normalizedPatch.unknown_contact_id ?? null,
        pipeline_stage: normalizedPatch.pipeline_stage ?? null,
        client_status: normalizedPatch.client_status ?? null,
      };
      state.contacts.unshift(inserted);
      if (
        state.activeKind === kind &&
        state.activeId === contact_id &&
        status
      ) {
        state.activeHubStatus = status;
      }
    },

    /** Patch outbound delivery status without a full timeline refetch. */
    messageStatusRealtime(
      state,
      action: {
        payload: { message_id: number; provider_status: string };
      },
    ) {
      if (!state.timeline?.messages) return;
      state.timeline = {
        ...state.timeline,
        messages: state.timeline.messages.map((m) =>
          m.id === action.payload.message_id
            ? { ...m, provider_status: action.payload.provider_status }
            : m,
        ),
      };
    },
    /** Patch call insights onto an open timeline message (Ably). */
    callInsightsRealtime(
      state,
      action: {
        payload: {
          message_id: number;
          call_insights_status?: ConversationMessage["call_insights_status"];
          call_insights_json?: ConversationMessage["call_insights_json"];
          call_transcript?: string | null;
          call_insights_error?: string | null;
        };
      },
    ) {
      if (!state.timeline?.messages) return;
      const p = action.payload;
      state.timeline = {
        ...state.timeline,
        messages: state.timeline.messages.map((m) =>
          m.id === p.message_id
            ? {
                ...m,
                call_insights_status:
                  p.call_insights_status ?? m.call_insights_status,
                call_insights_json:
                  p.call_insights_json !== undefined
                    ? p.call_insights_json
                    : m.call_insights_json,
                call_transcript:
                  p.call_transcript != null
                    ? decodeLiteralUnicodeEscapes(String(p.call_transcript))
                    : m.call_transcript,
                call_insights_error:
                  p.call_insights_error !== undefined
                    ? p.call_insights_error
                    : m.call_insights_error,
              }
            : m,
        ),
      };
    },
    /** Attach Twilio Dial recording URL onto an open timeline call row (Ably). */
    callRecordingRealtime(
      state,
      action: {
        payload: {
          message_id: number;
          recording_url?: string | null;
          call_duration_sec?: number | null;
        };
      },
    ) {
      if (!state.timeline?.messages) return;
      const p = action.payload;
      state.timeline = {
        ...state.timeline,
        messages: state.timeline.messages.map((m) =>
          m.id === p.message_id
            ? {
                ...m,
                recording_url: p.recording_url
                  ? String(p.recording_url)
                  : m.recording_url,
                call_duration_sec:
                  p.call_duration_sec != null
                    ? Number(p.call_duration_sec)
                    : m.call_duration_sec,
              }
            : m,
        ),
      };
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchConversationsAccess.pending, (s) => {
      s.accessLoading = true;
    });
    b.addCase(fetchConversationsAccess.fulfilled, (s, a) => {
      s.accessLoading = false;
      s.accessEnabled = a.payload.enabled;
      s.accessNumbers = a.payload.numbers || [];
    });
    b.addCase(fetchConversationsAccess.rejected, (s) => {
      s.accessLoading = false;
      s.accessEnabled = false;
    });

    b.addCase(fetchConversationsNavBadge.pending, (s) => {
      s.navBadgeLoading = true;
    });
    b.addCase(fetchConversationsNavBadge.fulfilled, (s, a) => {
      s.navBadgeLoading = false;
      s.navBadgeUnread = a.payload;
    });
    b.addCase(fetchConversationsNavBadge.rejected, (s) => {
      s.navBadgeLoading = false;
    });

    b.addCase(fetchConversationContacts.pending, (s, a) => {
      // Append ("Show more") keeps the list visible — no soft refresh opacity.
      if (!a.meta.arg?.append) {
        if (!s.contactsLoadedOnce) {
          s.contactsLoading = true;
        } else {
          s.contactsRefreshing = true;
        }
      }
      s.contactsError = null;
    });
    b.addCase(fetchConversationContacts.fulfilled, (s, a) => {
      s.contactsLoading = false;
      s.contactsRefreshing = false;
      s.contactsLoadedOnce = true;
      const next = a.payload.contacts || [];
      if (a.payload.append && next.length) {
        const seen = new Set(s.contacts.map(contactKey));
        const merged = [...s.contacts];
        for (const c of next) {
          const k = contactKey(c);
          if (seen.has(k)) {
            const i = merged.findIndex((x) => contactKey(x) === k);
            if (i >= 0) merged[i] = c;
          } else {
            seen.add(k);
            merged.push(c);
          }
        }
        s.contacts = merged;
      } else {
        s.contacts = next;
      }
      s.contactsPagination = a.payload.pagination;
    });
    b.addCase(fetchConversationContacts.rejected, (s, a) => {
      s.contactsLoading = false;
      s.contactsRefreshing = false;
      s.contactsError = (a.payload as string) || "Failed";
      if (String(a.payload || "").includes("conversations_number_required")) {
        s.accessEnabled = false;
      }
    });

    b.addCase(fetchConversationTimeline.pending, (s, a) => {
      const key = `${a.meta.arg.kind}:${a.meta.arg.id}`;
      if (s.timelineLoadedKey === key) {
        s.timelineRefreshing = true;
      } else {
        s.timelineLoading = true;
      }
    });
    b.addCase(fetchConversationTimeline.fulfilled, (s, a) => {
      s.timelineLoading = false;
      s.timelineRefreshing = false;
      const reqKind = a.meta.arg.kind;
      const reqId = a.meta.arg.id;
      if (s.activeKind !== reqKind || s.activeId !== reqId) {
        return;
      }
      s.timeline = a.payload;
      s.activeKind = a.payload.kind;
      s.timelineLoadedKey = `${a.payload.kind}:${a.meta.arg.id}`;
      const threadStatuses = (a.payload.threads || []).map((t) =>
        String(t.status || "open"),
      );
      if (threadStatuses.length) {
        const allClosed = threadStatuses.every(
          (st) => st === "closed" || st === "archived",
        );
        s.activeHubStatus = allClosed ? "closed" : "open";
      }
      // Keep unread badges in sync after mark-read on open
      if (s.activeId != null) {
        s.contacts = s.contacts.map((c) =>
          c.kind === a.payload.kind && c.contact_id === s.activeId
            ? {
                ...c,
                unread_count: 0,
                status: s.activeHubStatus || c.status,
              }
            : c,
        );
      }
    });
    b.addCase(fetchConversationTimeline.rejected, (s) => {
      s.timelineLoading = false;
      s.timelineRefreshing = false;
    });

    b.addCase(sendHubMessage.pending, (s) => {
      s.sending = true;
      s.sendError = null;
    });
    b.addCase(sendHubMessage.fulfilled, (s, a) => {
      s.sending = false;
      const { message_id, provider_status, error } = a.payload;
      if (s.timeline?.messages && message_id) {
        s.timeline = {
          ...s.timeline,
          messages: s.timeline.messages.map((m) =>
            m.id === message_id
              ? {
                  ...m,
                  provider_status:
                    provider_status ?? m.provider_status ?? null,
                  error_message: error ?? m.error_message ?? null,
                }
              : m,
          ),
        };
      }
    });
    b.addCase(sendHubMessage.rejected, (s, a) => {
      s.sending = false;
      s.sendError = (a.payload as string) || "Failed to send";
    });

    b.addCase(setConversationContactStatus.fulfilled, (s, a) => {
      const { kind, contactId, status, system_message, view } = a.payload;
      const normalizedStatus = status === "archived" ? "closed" : status;
      const isActive =
        s.activeKind === kind && s.activeId === contactId;

      if (isActive) {
        s.activeHubStatus = normalizedStatus;

        if (s.timeline?.threads?.length) {
          s.timeline = {
            ...s.timeline,
            threads: s.timeline.threads.map((t) => ({
              ...t,
              status: normalizedStatus,
            })),
            messages: system_message
              ? [...s.timeline.messages, system_message]
              : s.timeline.messages,
          };
        } else if (s.timeline && system_message) {
          s.timeline = {
            ...s.timeline,
            messages: [...s.timeline.messages, system_message],
          };
        }
      }

      const idx = s.contacts.findIndex(
        (c) => c.kind === kind && c.contact_id === contactId,
      );
      const viewHidesClosed =
        view === "mine" ||
        view === "all" ||
        view === "open" ||
        view === "unassigned" ||
        view === "unread" ||
        view === "unknown";
      const isClosed =
        normalizedStatus === "closed" || status === "archived";
      const viewHidesOpen = view === "closed";

      if (idx >= 0) {
        if ((isClosed && viewHidesClosed) || (!isClosed && viewHidesOpen)) {
          s.contacts.splice(idx, 1);
        } else {
          s.contacts[idx] = {
            ...s.contacts[idx],
            status: normalizedStatus,
            ...(a.payload.contact || {}),
          };
        }
      } else if (
        !isClosed &&
        !viewHidesOpen &&
        a.payload.contact &&
        (view === "all" || view === "mine" || view === "open")
      ) {
        // Reopened while viewing an open filter — insert if snapshot present
        const c = a.payload.contact;
        s.contacts.unshift({
          kind,
          contact_id: contactId,
          display_name: String(c.display_name || "").trim() || "Contact",
          phone: c.phone ?? null,
          email: c.email ?? null,
          last_message_at: c.last_message_at ?? null,
          last_message_preview: c.last_message_preview ?? null,
          unread_count: Number(c.unread_count ?? 0),
          status: normalizedStatus || "open",
          assigned_admin_id: c.assigned_admin_id ?? null,
          assigned_admin_name: c.assigned_admin_name ?? null,
          channels: c.channels ?? ["sms"],
          primary_conversation_id: c.primary_conversation_id ?? null,
          client_id: kind === "client" ? contactId : c.client_id ?? null,
          unknown_contact_id:
            kind === "unknown" ? contactId : c.unknown_contact_id ?? null,
          crm_contact_id:
            kind === "contact" ? contactId : c.crm_contact_id ?? null,
          pipeline_stage: c.pipeline_stage ?? null,
          client_status: c.client_status ?? null,
        });
      }
    });
    b.addCase(uploadConversationMedia.pending, (s) => {
      s.sendError = null;
    });
    b.addCase(uploadConversationMedia.rejected, (s, a) => {
      s.sendError = (a.payload as string) || "Failed to upload media";
    });

    b.addCase(fetchAdminPhoneNumbers.pending, (s) => {
      s.phoneNumbersLoading = true;
    });
    b.addCase(fetchAdminPhoneNumbers.fulfilled, (s, a) => {
      s.phoneNumbersLoading = false;
      s.phoneNumbers = a.payload;
    });
    b.addCase(fetchAdminPhoneNumbers.rejected, (s) => {
      s.phoneNumbersLoading = false;
    });

    b.addCase(syncAdminPhoneNumbersFromTwilio.fulfilled, (s, a) => {
      s.phoneNumbers = a.payload.numbers;
      s.phoneNumbersLoading = false;
    });

    b.addCase(assignAdminPhoneNumber.fulfilled, (s, a) => {
      s.phoneNumbers = s.phoneNumbers.map((n) =>
        n.id === a.payload.id ? a.payload : n,
      );
    });

    b.addCase(fetchConversationsAblyToken.fulfilled, (s, a) => {
      s.ablyTokenRequest = a.payload;
    });

    b.addCase(fetchConversationTemplates.pending, (s) => {
      s.templatesLoading = true;
    });
    b.addCase(fetchConversationTemplates.fulfilled, (s, a) => {
      s.templatesLoading = false;
      s.templates = a.payload;
    });
    b.addCase(fetchConversationTemplates.rejected, (s) => {
      s.templatesLoading = false;
    });
    b.addCase(createConversationTemplate.fulfilled, (s, a) => {
      s.templates = [...s.templates, a.payload].sort(
        (x, y) => x.sort_order - y.sort_order || x.id - y.id,
      );
    });
    b.addCase(updateConversationTemplate.fulfilled, (s, a) => {
      s.templates = s.templates.map((t) =>
        t.id === a.payload.id ? a.payload : t,
      );
    });
    b.addCase(deleteConversationTemplate.fulfilled, (s, a) => {
      s.templates = s.templates.filter((t) => t.id !== a.payload);
    });

    b.addCase(fetchConversationAiSuggestions.pending, (s) => {
      s.aiSuggestionsLoading = true;
    });
    b.addCase(fetchConversationAiSuggestions.fulfilled, (s, a) => {
      s.aiSuggestionsLoading = false;
      s.aiSuggestions = a.payload;
    });
    b.addCase(fetchConversationAiSuggestions.rejected, (s) => {
      s.aiSuggestionsLoading = false;
      s.aiSuggestions = [];
    });

    b.addCase(retryCallInsights.pending, (s, a) => {
      s.retryCallInsightsId = a.meta.arg.messageId;
    });
    b.addCase(retryCallInsights.fulfilled, (s, a) => {
      s.retryCallInsightsId = null;
      if (!s.timeline?.messages || !a.payload.message) return;
      const next = a.payload.message;
      s.timeline = {
        ...s.timeline,
        messages: s.timeline.messages.map((m) =>
          m.id === a.payload.messageId ? { ...m, ...next } : m,
        ),
      };
    });
    b.addCase(retryCallInsights.rejected, (s) => {
      s.retryCallInsightsId = null;
    });
  },
});

export const {
  setConversationsView,
  setConversationsSearch,
  clearActiveConversation,
  selectConversationContact,
  setConversationsSendError,
  contactActivityRealtime,
  messageStatusRealtime,
  callInsightsRealtime,
  callRecordingRealtime,
} = slice.actions;

export default slice.reducer;
