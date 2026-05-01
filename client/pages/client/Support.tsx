import { useEffect, useState } from "react";
import { LifeBuoy, MessageSquare, Plus, Send } from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createTicket,
  fetchTickets,
  replyTicket,
} from "@/store/slices/portalSlice";
import api from "@/lib/api";

export default function Support() {
  const dispatch = useAppDispatch();
  const { tickets } = useAppSelector((s) => s.portal);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    dispatch(fetchTickets());
  }, [dispatch]);

  const form = useFormik({
    initialValues: { subject: "", body: "", category: "general" },
    validationSchema: Yup.object({
      subject: Yup.string().required("Required"),
      body: Yup.string().min(10, "Min 10 chars").required("Required"),
    }),
    onSubmit: async (values, { resetForm }) => {
      const r = await dispatch(createTicket(values));
      if (createTicket.fulfilled.match(r)) {
        resetForm();
        setShowForm(false);
        dispatch(fetchTickets());
      }
    },
  });

  const openTicket = async (id: number) => {
    setOpenId(id);
    const { data } = await api.get(`/portal/tickets/${id}`);
    setReplies(data.replies || []);
  };

  const submitReply = async () => {
    if (!openId || !replyText.trim()) return;
    await dispatch(replyTicket({ ticketId: openId, body: replyText }));
    setReplyText("");
    const { data } = await api.get(`/portal/tickets/${openId}`);
    setReplies(data.replies || []);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <LifeBuoy className="w-7 h-7 text-primary" /> Support
          </h1>
          <p className="text-muted-foreground">We typically reply in 24 hrs.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary inline-flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" /> New ticket
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={form.handleSubmit}
          className="bg-card rounded-2xl border border-border p-6 space-y-4"
        >
          <input
            placeholder="Subject"
            {...form.getFieldProps("subject")}
            className="w-full h-11 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <textarea
            placeholder="How can we help?"
            rows={5}
            {...form.getFieldProps("body")}
            className="w-full p-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
          <select
            {...form.getFieldProps("category")}
            className="h-11 px-3 rounded-lg border border-border bg-input"
          >
            <option value="general">General</option>
            <option value="billing">Billing</option>
            <option value="documents">Documents</option>
            <option value="dispute">Dispute</option>
            <option value="technical">Technical</option>
          </select>
          <button type="submit" className="btn-primary">
            Submit
          </button>
        </form>
      )}

      {tickets.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No support tickets yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div
              key={t.id}
              className="bg-card rounded-2xl border border-border p-5 cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => openTicket(t.id)}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold">{t.subject}</h3>
                <span className="text-xs uppercase tracking-wide bg-secondary px-2 py-0.5 rounded-full">
                  {t.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(t.created_at).toLocaleString()}
              </p>

              {openId === t.id && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {replies.map((r: any) => (
                    <div
                      key={r.id}
                      className={`p-3 rounded-lg text-sm ${
                        r.author_type === "client"
                          ? "bg-primary/5 ml-8"
                          : "bg-secondary mr-8"
                      }`}
                    >
                      <div className="text-xs text-muted-foreground mb-1">
                        {r.author_type === "client" ? "You" : "Support"} ·{" "}
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                      <div className="whitespace-pre-wrap">{r.body}</div>
                    </div>
                  ))}
                  <div
                    className="flex gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply…"
                      className="flex-1 h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                    <button
                      onClick={submitReply}
                      className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5"
                    >
                      <Send className="w-4 h-4" /> Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
