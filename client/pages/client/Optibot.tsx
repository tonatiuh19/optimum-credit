import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchChatSessions,
  fetchChatMessages,
  sendChatMessage,
  addLocalChatMessage,
} from "@/store/slices/portalSlice";

export default function Optibot() {
  const dispatch = useAppDispatch();
  const { chatMessages, chatSessions } = useAppSelector((s) => s.portal);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dispatch(fetchChatSessions());
  }, [dispatch]);

  useEffect(() => {
    if (chatSessions.length && !sessionId) {
      const id = chatSessions[0].id;
      setSessionId(id);
      dispatch(fetchChatMessages({ sessionId: id }));
    }
  }, [chatSessions, sessionId, dispatch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);

    const tempUser = {
      id: -Date.now(),
      session_id: sessionId || 0,
      role: "user" as const,
      content,
      created_at: new Date().toISOString(),
    };
    dispatch(addLocalChatMessage(tempUser));

    const result = await dispatch(
      sendChatMessage({ content, session_id: sessionId || undefined }),
    );
    setSending(false);
    if (sendChatMessage.fulfilled.match(result)) {
      const newSid = (result.payload as any).session_id;
      if (!sessionId) setSessionId(newSid);
      dispatch(fetchChatMessages({ sessionId: newSid }));
    }
  };

  const suggestions = [
    "What documents do I need to upload?",
    "How long does credit repair take?",
    "Explain my last dispute round",
    "How can I improve my score faster?",
  ];

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-7rem)] md:h-[calc(100vh-6rem)]">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Bot className="w-7 h-7 text-primary" /> Optibot AI
        </h1>
        <p className="text-muted-foreground">
          Your 24/7 credit repair assistant.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 bg-card rounded-2xl border border-border p-4 overflow-y-auto min-h-[300px]"
      >
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="font-semibold text-lg">Hi! I'm Optibot.</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-5">
              Ask me anything about your credit repair journey.
            </p>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-sm text-left p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {chatMessages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-secondary text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-2.5">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.15s]" />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.3s]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 bg-card rounded-2xl border border-border p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Optibot anything…"
          className="flex-1 bg-transparent px-3 h-11 focus:outline-none text-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="h-11 px-4 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary-600 transition-colors flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  );
}
