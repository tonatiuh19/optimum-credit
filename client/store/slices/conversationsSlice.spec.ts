import { describe, expect, it } from "vitest";
import reducer, {
  contactActivityRealtime,
  fetchConversationContacts,
  fetchConversationTimeline,
  fetchConversationsNavBadge,
  mapConversationHubMessage,
  messageStatusRealtime,
  selectConversationContact,
  setConversationContactStatus,
} from "./conversationsSlice";
import type { ConversationContactHubItem } from "@shared/api";

const baseContact = (
  overrides: Partial<ConversationContactHubItem> = {},
): ConversationContactHubItem => ({
  kind: "client",
  contact_id: 1,
  display_name: "Alex Gomez",
  phone: "+13234756240",
  email: null,
  last_message_at: "2026-08-22T00:00:00.000Z",
  last_message_preview: "Hi",
  unread_count: 2,
  status: "open",
  assigned_admin_id: 10,
  assigned_admin_name: "Agent",
  channels: ["sms"],
  primary_conversation_id: 99,
  client_id: 1,
  ...overrides,
});

describe("conversationsSlice realtime reducers", () => {
  it("bubbles contact to top on inbound patch with last_message_at", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      contacts: [
        baseContact({ contact_id: 1, display_name: "First" }),
        baseContact({ contact_id: 2, display_name: "Second" }),
      ],
      navBadgeUnread: 5,
    };

    state = reducer(
      state,
      contactActivityRealtime({
        kind: "client",
        contact_id: 2,
        patch: {
          last_message_at: "2026-08-22T01:00:00.000Z",
          last_message_preview: "New text",
          unread_count: 3,
        },
      }),
    );

    expect(state.contacts[0].contact_id).toBe(2);
    expect(state.contacts[0].last_message_preview).toBe("New text");
    expect(state.navBadgeUnread).toBe(5);
  });

  it("inserts unknown contact when Ably patch is for a new thread", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = reducer(
      state,
      contactActivityRealtime({
        kind: "unknown",
        contact_id: 55,
        patch: {
          display_name: "+15551234567",
          last_message_at: "2026-08-22T01:00:00.000Z",
          unread_count: 1,
        },
      }),
    );
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0].kind).toBe("unknown");
    expect(state.contacts[0].contact_id).toBe(55);
  });

  it("Ably status closed removes contact from open view", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      view: "open",
      contacts: [baseContact({ contact_id: 7, status: "open" })],
      activeKind: "client",
      activeId: 7,
      activeHubStatus: "open",
    };
    state = reducer(
      state,
      contactActivityRealtime({
        kind: "client",
        contact_id: 7,
        patch: { status: "closed" },
      }),
    );
    expect(state.contacts).toHaveLength(0);
    expect(state.activeHubStatus).toBe("closed");
    expect(state.activeId).toBe(7);
  });

  it("patches provider status on open timeline without refetch", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      timeline: {
        kind: "client",
        contact: {},
        messages: [
          {
            id: 7,
            direction: "outbound",
            channel: "sms",
            body: "sent",
            provider_status: "queued",
            created_at: "2026-08-22T00:00:00.000Z",
          },
        ],
      },
    };

    state = reducer(
      state,
      messageStatusRealtime({
        message_id: 7,
        provider_status: "delivered",
      }),
    );

    expect(state.timeline?.messages[0].provider_status).toBe("delivered");
  });

  it("closing a non-active list row does not rewrite the open panel status", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      view: "all",
      contacts: [
        baseContact({ contact_id: 1, status: "open" }),
        baseContact({ contact_id: 2, display_name: "Other", status: "open" }),
      ],
      activeKind: "client",
      activeId: 1,
      activeHubStatus: "open",
      timeline: {
        kind: "client",
        contact: {},
        messages: [
          {
            id: 1,
            direction: "outbound",
            channel: "sms",
            body: "Hello",
            created_at: "2026-08-25T00:00:00.000Z",
          },
        ],
        threads: [{ id: 9, status: "open" } as any],
      },
    };

    state = reducer(
      state,
      setConversationContactStatus.fulfilled(
        {
          kind: "client",
          contactId: 2,
          status: "closed",
          system_message: {
            id: 99,
            direction: "system",
            channel: "internal",
            body: "Conversation closed",
            created_at: "2026-08-25T01:00:00.000Z",
          } as any,
          contact: null,
          view: "all",
        },
        "req-close-other",
        { kind: "client", contactId: 2, status: "closed" },
      ),
    );

    expect(state.activeHubStatus).toBe("open");
    expect(state.activeId).toBe(1);
    expect(state.timeline?.messages).toHaveLength(1);
    expect(state.contacts.find((c) => c.contact_id === 2)?.status).toBe(
      "closed",
    );
  });
});

describe("conversationsSlice async guards", () => {
  it("ignores stale timeline responses when active contact changed", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = reducer(
      state,
      selectConversationContact({ kind: "client", id: 1 }),
    );
    state = {
      ...state,
      activeKind: "client",
      activeId: 2,
      timeline: {
        kind: "client",
        contact: { first_name: "Current" },
        messages: [],
      },
    };

    state = reducer(
      state,
      fetchConversationTimeline.fulfilled(
        {
          kind: "client",
          contact: { first_name: "Stale" },
          messages: [{ id: 1, body: "old", direction: "inbound", channel: "sms", created_at: "" }],
        },
        "req-stale",
        { kind: "client", id: 1 },
      ),
    );

    expect(state.timeline?.contact).toEqual({ first_name: "Current" });
  });

  it("clears unread on active contact when timeline load completes", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      activeKind: "client",
      activeId: 1,
      contacts: [baseContact({ unread_count: 4 })],
    };

    state = reducer(
      state,
      fetchConversationTimeline.fulfilled(
        {
          kind: "client",
          contact: {},
          messages: [],
        },
        "req-ok",
        { kind: "client", id: 1 },
      ),
    );

    expect(state.contacts[0].unread_count).toBe(0);
  });

  it("nav badge comes only from badge API, not contacts list", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = { ...state, navBadgeUnread: 12 };

    state = reducer(
      state,
      fetchConversationContacts.fulfilled(
        {
          contacts: [baseContact({ unread_count: 99 })],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
        "req-contacts",
        { view: "mine" },
      ),
    );
    expect(state.navBadgeUnread).toBe(12);

    state = reducer(
      state,
      fetchConversationsNavBadge.fulfilled(3, "req-badge", undefined),
    );
    expect(state.navBadgeUnread).toBe(3);
  });

  it("keeps nav badge on badge fetch failure", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = { ...state, navBadgeUnread: 8 };
    state = reducer(
      state,
      fetchConversationsNavBadge.rejected(
        new Error("network"),
        "req-badge",
        undefined,
        "Failed",
      ),
    );
    expect(state.navBadgeUnread).toBe(8);
  });
});

describe("mapConversationHubMessage", () => {
  it("preserves call recording_url and call_duration_sec", () => {
    const mapped = mapConversationHubMessage({
      id: 42,
      conversation_id: 7,
      direction: "inbound",
      channel: "call",
      body: "Incoming call",
      media_url: null,
      media_content_type: null,
      from_address: "+15551112222",
      to_address: "+15553334444",
      sent_by_admin_id: null,
      sent_by_admin_name: null,
      provider_message_id: "CAtest",
      provider_status: "completed",
      error_message: null,
      call_duration_sec: "33",
      recording_url: "https://api.twilio.com/Recordings/RExxx",
      metadata_json: JSON.stringify({ is_voicemail: true }),
      created_at: "2026-08-24T12:00:00.000Z",
    });
    expect(mapped.call_duration_sec).toBe(33);
    expect(mapped.recording_url).toContain("Recordings/RExxx");
    expect(mapped.metadata_json).toEqual({ is_voicemail: true });
  });

  it("maps system close/reopen events", () => {
    const mapped = mapConversationHubMessage({
      id: 9,
      conversation_id: 1,
      direction: "system",
      channel: "internal",
      body: "closed",
      metadata_json: JSON.stringify({ system_event: true }),
      created_at: "2026-08-25T12:00:00.000Z",
    });
    expect(mapped.direction).toBe("system");
    expect(mapped.body).toBe("closed");
  });
});
