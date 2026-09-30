import { describe, expect, it } from "vitest";
import reducer, {
  contactActivityRealtime,
  callRecordingRealtime,
  fetchConversationContacts,
  fetchConversationTimeline,
  fetchConversationsNavBadge,
  mapConversationContact,
  mapConversationHubMessage,
  mapConversationTemplate,
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
    // Closed rows leave All/Mine/etc.; panel for the still-open contact is unchanged
    expect(state.contacts.map((c) => c.contact_id)).toEqual([1]);
    expect(state.contacts.find((c) => c.contact_id === 2)).toBeUndefined();
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
          append: false,
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

describe("mapConversationContact", () => {
  it("decodes literal unicode escapes in last_message_preview", () => {
    const mapped = mapConversationContact(
      baseContact({
        last_message_preview: "Hola Marta, solo dando seguimiento \\u2014...",
      }),
    );
    expect(mapped.last_message_preview).toBe(
      "Hola Marta, solo dando seguimiento —...",
    );
  });
});

describe("fetchConversationContacts append", () => {
  it("appends unique contacts and updates duplicates in place", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      contacts: [baseContact({ contact_id: 1, display_name: "First" })],
      contactsPagination: { page: 1, limit: 25, total: 3, totalPages: 2 },
    };
    state = reducer(
      state,
      fetchConversationContacts.fulfilled(
        {
          contacts: [
            mapConversationContact(
              baseContact({
                contact_id: 1,
                display_name: "First updated",
                last_message_preview: "Hi \\u2014 there",
              }),
            ),
            mapConversationContact(
              baseContact({ contact_id: 2, display_name: "Second" }),
            ),
          ],
          pagination: { page: 2, limit: 25, total: 3, totalPages: 2 },
          append: true,
        },
        "req-append",
        { page: 2, append: true },
      ),
    );
    expect(state.contacts).toHaveLength(2);
    expect(state.contacts[0].display_name).toBe("First updated");
    expect(state.contacts[0].last_message_preview).toBe("Hi — there");
    expect(state.contacts[1].contact_id).toBe(2);
    expect(state.contactsPagination?.page).toBe(2);
  });

  it("replaces contacts when append is false", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      contacts: [
        baseContact({ contact_id: 1 }),
        baseContact({ contact_id: 2 }),
      ],
    };
    state = reducer(
      state,
      fetchConversationContacts.fulfilled(
        {
          contacts: [baseContact({ contact_id: 9, display_name: "Only" })],
          pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
          append: false,
        },
        "req-replace",
        { page: 1 },
      ),
    );
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0].contact_id).toBe(9);
  });
});

describe("mapConversationTemplate", () => {
  it("decodes literal unicode escapes in body/subject", () => {
    const mapped = mapConversationTemplate({
      id: 1,
      name: "Follow up",
      channel: "sms",
      subject: null,
      body: "Hola \\u2014 solo dando seguimiento",
      variables: [],
      is_active: true,
      sort_order: 0,
      created_at: "2026-09-04T00:00:00.000Z",
      updated_at: "2026-09-04T00:00:00.000Z",
    });
    expect(mapped.body).toBe("Hola — solo dando seguimiento");
  });
});

describe("mapConversationHubMessage", () => {
  it("decodes literal unicode escapes in body (LLM double-escape)", () => {
    const mapped = mapConversationHubMessage({
      id: 1,
      direction: "outbound",
      channel: "sms",
      body: "Hi Valeria, saw I missed your call \\u2014 I'm in meetings",
      created_at: "2026-09-04T11:10:00.000Z",
    });
    expect(mapped.body).toBe(
      "Hi Valeria, saw I missed your call — I'm in meetings",
    );
  });

  it("expands literal \\n in body (LLM paragraph escapes)", () => {
    const mapped = mapConversationHubMessage({
      id: 2,
      direction: "outbound",
      channel: "sms",
      body: "real-time updates.\\n\\nTo give you an accurate price",
      created_at: "2026-09-12T14:50:00.000Z",
    });
    expect(mapped.body).toBe(
      "real-time updates.\n\nTo give you an accurate price",
    );
  });

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

  it("maps call insights fields and decodes transcript escapes", () => {
    const mapped = mapConversationHubMessage({
      id: 43,
      conversation_id: 7,
      direction: "inbound",
      channel: "call",
      body: "Incoming call",
      call_duration_sec: 60,
      recording_url: "https://api.twilio.com/Recordings/REyyy",
      call_insights_status: "ready",
      call_transcript: "Client said \\u2014 ready for Round 2",
      call_insights_json: JSON.stringify({
        locale: "en",
        summary_bullets: ["Round 2"],
        sentiment: { label: "hopeful", score: 0.8, feelings: ["optimistic"] },
        topics: ["Round 2"],
        action_items: [],
        risk_flags: [],
        interesting: [],
      }),
      created_at: "2026-09-04T12:00:00.000Z",
    });
    expect(mapped.call_insights_status).toBe("ready");
    expect(mapped.call_transcript).toBe("Client said — ready for Round 2");
    expect(mapped.call_insights_json?.sentiment?.label).toBe("hopeful");
    expect(mapped.call_insights_json?.summary_bullets).toEqual(["Round 2"]);
  });

  it("callRecordingRealtime patches recording_url onto open timeline", () => {
    let state = reducer(undefined, { type: "@@INIT" });
    state = {
      ...state,
      timeline: {
        kind: "client",
        contact: {},
        messages: [
          {
            id: 43,
            conversation_id: 7,
            direction: "outbound",
            channel: "call",
            body: "Voice call — 40s (completed)",
            recording_url: null,
            call_duration_sec: 40,
            created_at: "2026-09-14T12:00:00.000Z",
          } as any,
        ],
      },
    };
    state = reducer(
      state,
      callRecordingRealtime({
        message_id: 43,
        recording_url: "https://api.twilio.com/Recordings/REnew.mp3",
        call_duration_sec: 42,
      }),
    );
    expect(state.timeline?.messages[0].recording_url).toContain("REnew");
    expect(state.timeline?.messages[0].call_duration_sec).toBe(42);
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
