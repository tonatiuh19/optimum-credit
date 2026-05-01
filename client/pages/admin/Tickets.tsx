import { useEffect, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminTicket,
  fetchAdminTickets,
  replyAdminTicket,
  updateTicketStatus,
} from "@/store/slices/adminSlice";

export default function AdminTickets() {
  const dispatch = useAppDispatch();
  const { tickets, selectedTicket, ticketReplies } = useAppSelector(
    (s) => s.admin,
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  useEffect(() => {
    dispatch(fetchAdminTickets());
  }, [dispatch]);

  const open = (id: number) => {
    setActiveId(id);
    dispatch(fetchAdminTicket({ id }));
  };

  const submit = async () => {
    if (!activeId || !reply.trim()) return;
    await dispatch(
      replyAdminTicket({
        ticketId: activeId,
        body: reply,
        is_internal_note: internal,
      }),
    );
    setReply("");
    dispatch(fetchAdminTicket({ id: activeId }));
  };

  const setStatus = async (status: string) => {
    if (!activeId) return;
    await dispatch(updateTicketStatus({ ticketId: activeId, status }));
    dispatch(fetchAdminTickets());
    dispatch(fetchAdminTicket({ id: activeId }));
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={LifeBuoy}
        title="Support Tickets"
        description="Review and respond to client support requests."
      />

      <div className="grid md:grid-cols-3 gap-4 h-[calc(100vh-14rem)]">
        <div className="bg-card rounded-2xl border border-border overflow-y-auto">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => open(t.id)}
              className={`w-full text-left p-4 border-b border-border/50 hover:bg-muted/50 ${
                activeId === t.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm truncate">{t.subject}</div>
                <span className="text-[10px] uppercase ml-2 bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  {t.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {(t as any).client_first_name} {(t as any).client_last_name}
              </div>
            </button>
          ))}
        </div>

        <div className="md:col-span-2 bg-card rounded-2xl border border-border flex flex-col">
          {!selectedTicket || selectedTicket.id !== activeId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Select a ticket
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border flex justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{selectedTicket.subject}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedTicket.body}
                  </p>
                </div>
                <select
                  value={selectedTicket.status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-input bg-background text-sm text-foreground"
                >
                  <option>open</option>
                  <option>pending</option>
                  <option>resolved</option>
                  <option>closed</option>
                </select>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {ticketReplies.map((r: any) => (
                  <div
                    key={r.id}
                    className={`p-3 rounded-lg text-sm ${
                      r.is_internal_note
                        ? "bg-yellow-500/10 border border-yellow-500/30"
                        : r.author_type === "client"
                          ? "bg-muted"
                          : "bg-primary/10"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      {r.author_type === "client" ? "Client" : "Staff"}
                      {r.is_internal_note && " · INTERNAL"} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap">{r.body}</div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-border space-y-2">
                <textarea
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply…"
                  className="w-full p-2 rounded-lg border border-input bg-background text-sm text-foreground"
                />
                <div className="flex justify-between items-center">
                  <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    Internal note (not visible to client)
                  </label>
                  <button
                    onClick={submit}
                    className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5"
                  >
                    <Send className="w-4 h-4" /> Reply
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
