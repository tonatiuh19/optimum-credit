import { useEffect, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchConversationMessages,
  fetchConversations,
  sendConversationMessage,
} from "@/store/slices/adminSlice";

export default function AdminConversations() {
  const dispatch = useAppDispatch();
  const { conversations, conversationMessages } = useAppSelector(
    (s) => s.admin,
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");

  useEffect(() => {
    dispatch(fetchConversations());
  }, [dispatch]);

  const active = conversations.find((c) => c.id === activeId);
  const messages = activeId ? conversationMessages[activeId] || [] : [];

  const open = (id: number) => {
    setActiveId(id);
    dispatch(fetchConversationMessages({ id }));
  };

  const send = async () => {
    if (!active || !body.trim()) return;
    await dispatch(
      sendConversationMessage({
        client_id: active.client_id,
        channel,
        body,
        subject: subject || undefined,
      }),
    );
    setBody("");
    setSubject("");
    dispatch(fetchConversationMessages({ id: active.id }));
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={MessageSquare}
        title="Conversations"
        description="SMS, email, and call history with clients."
      />

      <div className="grid md:grid-cols-3 gap-4 h-[calc(100vh-14rem)]">
        <div className="bg-card rounded-2xl border border-border overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-muted-foreground text-sm">
              No conversations.
            </div>
          ) : (
            conversations.map((c: any) => (
              <button
                key={c.id}
                onClick={() => open(c.id)}
                className={`w-full text-left p-4 border-b border-border/50 hover:bg-muted/50 transition-colors ${
                  activeId === c.id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium text-sm">
                  {c.client_first_name} {c.client_last_name}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {c.last_message_preview || "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 uppercase">
                  {c.channel}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="md:col-span-2 bg-card rounded-2xl border border-border flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border">
                <div className="font-semibold">
                  {active.client_first_name} {active.client_last_name}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m: any) => (
                  <div
                    key={m.id}
                    className={`flex ${
                      m.direction === "outbound"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                        m.direction === "outbound"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {m.subject && (
                        <div className="font-semibold mb-1">{m.subject}</div>
                      )}
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className="text-[10px] opacity-70 mt-1">
                        {m.message_type} ·{" "}
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-border space-y-2">
                <div className="flex gap-2">
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as any)}
                    className="h-9 px-2 rounded-lg border border-input bg-background text-sm text-foreground"
                  >
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                  {channel === "email" && (
                    <input
                      placeholder="Subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    placeholder="Message"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="flex-1 p-2 rounded-lg border border-input bg-background text-sm text-foreground resize-y"
                  />
                  <button
                    onClick={send}
                    className="px-4 rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-1.5"
                  >
                    <Send className="w-4 h-4" /> Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
