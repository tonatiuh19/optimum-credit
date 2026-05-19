import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  LifeBuoy,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createAdminFaq,
  deleteAdminFaq,
  fetchAdminFaqs,
  fetchAdminTicket,
  fetchAdminTickets,
  replyAdminTicket,
  updateAdminFaq,
  updateTicketStatus,
} from "@/store/slices/adminSlice";
import type { SupportFaq } from "@shared/api";

// ── Category label map ──────────────────────────────────────────────────────
const CAT_LABELS: Record<string, string> = {
  billing: "Billing & Payments",
  documents: "Documents & Files",
  process: "Credit Repair Process",
  technical: "Technical Issue",
  general: "General",
  other: "Other",
};

const FAQ_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "billing", label: "Billing & Payments" },
  { value: "documents", label: "Documents & Files" },
  { value: "process", label: "Credit Repair Process" },
  { value: "technical", label: "Technical Issue" },
] as const;

// ── Ticket status helpers ───────────────────────────────────────────────────
const STATUS_MAP: Record<string, string> = {
  open: "bg-accent/10 text-accent",
  in_progress: "bg-primary/10 text-primary",
  waiting_client: "bg-orange-500/10 text-orange-500",
  resolved: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

// ── FAQ Form (create / edit) ────────────────────────────────────────────────
function FaqForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<SupportFaq>;
  onSave: (vals: {
    question: string;
    answer: string;
    category: string;
    sort_order: number;
    is_active: boolean;
  }) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const form = useFormik({
    initialValues: {
      question: initial?.question ?? "",
      answer: initial?.answer ?? "",
      category: initial?.category ?? "general",
      sort_order: initial?.sort_order ?? 0,
      is_active: initial?.is_active !== 0,
    },
    validationSchema: Yup.object({
      question: Yup.string().min(5).required("Question is required"),
      answer: Yup.string().min(10).required("Answer is required"),
    }),
    onSubmit: (values) => onSave(values),
    enableReinitialize: true,
  });

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          Question
        </label>
        <input
          {...form.getFieldProps("question")}
          placeholder="What is the question clients often ask?"
          className="w-full h-10 px-3 rounded-lg border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {form.touched.question && form.errors.question && (
          <p className="text-xs text-destructive mt-1">
            {form.errors.question}
          </p>
        )}
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          Answer
        </label>
        <textarea
          {...form.getFieldProps("answer")}
          rows={4}
          placeholder="Provide a clear, helpful answer…"
          className="w-full p-3 rounded-lg border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
        />
        {form.touched.answer && form.errors.answer && (
          <p className="text-xs text-destructive mt-1">{form.errors.answer}</p>
        )}
      </div>
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Category
          </label>
          <select
            {...form.getFieldProps("category")}
            className="h-10 w-full px-3 rounded-lg border border-border bg-input text-sm"
          >
            {FAQ_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Sort order
          </label>
          <input
            type="number"
            min={0}
            {...form.getFieldProps("sort_order")}
            className="h-10 w-full px-3 rounded-lg border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.values.is_active}
              onChange={(e) =>
                form.setFieldValue("is_active", e.target.checked)
              }
              className="rounded"
            />
            Active (visible to clients)
          </label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || form.isSubmitting}
          className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving || form.isSubmitting ? "Saving…" : "Save FAQ"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 h-9 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── FAQ Management Panel ────────────────────────────────────────────────────
function FaqPanel() {
  const dispatch = useAppDispatch();
  const { faqs } = useAppSelector((s) => s.admin);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchAdminFaqs());
  }, [dispatch]);

  const handleCreate = async (
    vals: Parameters<typeof createAdminFaq>[0] extends infer T ? T : never,
  ) => {
    setSaving(true);
    await dispatch(createAdminFaq(vals as any));
    await dispatch(fetchAdminFaqs());
    setSaving(false);
    setCreating(false);
  };

  const handleUpdate = async (id: number, vals: any) => {
    setSaving(true);
    await dispatch(updateAdminFaq({ id, ...vals }));
    await dispatch(fetchAdminFaqs());
    setSaving(false);
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this FAQ? Clients will no longer see it."))
      return;
    await dispatch(deleteAdminFaq(id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">FAQ Management</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            These items appear in the client support page before raising a
            ticket.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add FAQ
          </button>
        )}
      </div>

      {creating && (
        <div className="bg-card rounded-2xl border border-primary/30 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" /> New FAQ item
          </h3>
          <FaqForm
            saving={saving}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {faqs.length === 0 && !creating ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <HelpCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No FAQ items yet.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add your first FAQ
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {faqs.map((faq) => (
            <div
              key={faq.id}
              className={`bg-card rounded-xl border transition-colors ${faq.is_active ? "border-border" : "border-border/50 opacity-60"}`}
            >
              {editingId === faq.id ? (
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold">Edit FAQ</h3>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <FaqForm
                    initial={faq}
                    saving={saving}
                    onSave={(vals) => handleUpdate(faq.id, vals)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((p) => (p === faq.id ? null : faq.id))
                    }
                    className="w-full flex items-center gap-3 px-5 py-4 text-left"
                  >
                    <span className="flex-1 text-sm font-medium leading-snug">
                      {faq.question}
                    </span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      {CAT_LABELS[faq.category] ?? faq.category}
                    </span>
                    {!faq.is_active && (
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-destructive/10 text-destructive shrink-0">
                        hidden
                      </span>
                    )}
                    <span className="text-muted-foreground shrink-0">
                      {expandedId === faq.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                  </button>

                  {expandedId === faq.id && (
                    <div className="px-5 pb-4 border-t border-border bg-muted/20">
                      <p className="text-sm text-muted-foreground leading-relaxed pt-3 mb-4">
                        {faq.answer}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingId(faq.id);
                            setExpandedId(null);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(faq.id)}
                          className="inline-flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                        <span className="text-xs text-muted-foreground ml-auto">
                          Order: {faq.sort_order}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function AdminTickets() {
  const dispatch = useAppDispatch();
  const { tickets, selectedTicket, ticketReplies } = useAppSelector(
    (s) => s.admin,
  );
  const [tab, setTab] = useState<"tickets" | "faq">("tickets");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  useEffect(() => {
    dispatch(fetchAdminTickets(undefined));
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
    dispatch(fetchAdminTickets(undefined));
    dispatch(fetchAdminTicket({ id: activeId }));
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={LifeBuoy}
        title="Support"
        description="Review client tickets and manage FAQ content."
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("tickets")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "tickets"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Tickets{" "}
          {tickets.length > 0 && (
            <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
              {tickets.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("faq")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "faq"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          FAQ Management
        </button>
      </div>

      {/* Tickets tab */}
      {tab === "tickets" && (
        <div className="grid md:grid-cols-3 gap-4 md:h-[calc(100vh-18rem)]">
          {/* List panel */}
          <div
            className={`bg-card rounded-2xl border border-border overflow-y-auto max-h-[45vh] md:max-h-none ${
              activeId ? "hidden md:block" : "block"
            }`}
          >
            {tickets.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No tickets yet.
              </div>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => open(t.id)}
                  className={`w-full text-left p-4 border-b border-border/50 hover:bg-muted/50 transition-colors ${
                    activeId === t.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate">
                      {t.subject}
                    </div>
                    <span
                      className={`text-[10px] shrink-0 uppercase px-1.5 py-0.5 rounded font-medium ${STATUS_MAP[t.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>
                      {(t as any).client_first_name}{" "}
                      {(t as any).client_last_name}
                    </span>
                    {t.category && (
                      <>
                        <span>·</span>
                        <span className="capitalize">
                          {CAT_LABELS[t.category] ?? t.category}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Chat panel */}
          <div
            className={`md:col-span-2 bg-card rounded-2xl border border-border flex flex-col ${
              activeId ? "flex min-h-[65vh] md:min-h-0" : "hidden md:flex"
            }`}
          >
            {!selectedTicket || selectedTicket.id !== activeId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select a ticket to view the conversation
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-border flex flex-wrap justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => setActiveId(null)}
                      className="md:hidden mb-2 flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      ← Back to list
                    </button>
                    <h3 className="text-base font-semibold truncate">
                      {selectedTicket.subject}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {selectedTicket.body}
                    </p>
                    {selectedTicket.category && (
                      <span className="inline-block mt-1 text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {CAT_LABELS[selectedTicket.category] ??
                          selectedTicket.category}
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-9 px-2 rounded-lg border border-input bg-background text-sm text-foreground shrink-0"
                  >
                    <option value="open">open</option>
                    <option value="in_progress">in_progress</option>
                    <option value="waiting_client">waiting_client</option>
                    <option value="resolved">resolved</option>
                    <option value="closed">closed</option>
                  </select>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {ticketReplies.map((r: any) => (
                    <div
                      key={r.id}
                      className={`p-3 rounded-xl text-sm ${
                        r.is_internal_note
                          ? "bg-yellow-500/10 border border-yellow-500/30"
                          : r.author_type === "client"
                            ? "bg-muted"
                            : "bg-primary/10"
                      }`}
                    >
                      <div className="text-xs text-muted-foreground mb-1 font-medium">
                        {r.author_type === "client" ? "Client" : "Staff"}
                        {r.is_internal_note && (
                          <span className="ml-1 text-yellow-600">
                            · INTERNAL NOTE
                          </span>
                        )}{" "}
                        · {new Date(r.created_at).toLocaleString()}
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.metaKey) submit();
                    }}
                  />
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-muted-foreground inline-flex items-center gap-2 cursor-pointer">
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
      )}

      {/* FAQ tab */}
      {tab === "faq" && <FaqPanel />}
    </div>
  );
}
