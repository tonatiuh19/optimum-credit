import { useEffect, useState } from "react";
import ClientPageHeader from "@/components/ClientPageHeader";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  HelpCircle,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  Send,
  Wrench,
} from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createTicket,
  fetchFaqs,
  fetchTickets,
  replyTicket,
} from "@/store/slices/portalSlice";
import api from "@/lib/api";

// ── Category definitions ────────────────────────────────────────────────────
const CATEGORY_VALUES = [
  "billing",
  "documents",
  "process",
  "technical",
  "other",
] as const;
type CategoryValue = (typeof CATEGORY_VALUES)[number];

const CATEGORY_META = [
  {
    value: "billing" as CategoryValue,
    icon: CreditCard,
    color: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/30",
  },
  {
    value: "documents" as CategoryValue,
    icon: FileText,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
  },
  {
    value: "process" as CategoryValue,
    icon: RefreshCw,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  {
    value: "technical" as CategoryValue,
    icon: Wrench,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
  },
  {
    value: "other" as CategoryValue,
    icon: HelpCircle,
    color: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
];

// ── FAQ accordion item ──────────────────────────────────────────────────────
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="font-medium text-sm">{question}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border bg-muted/30">
          <p className="pt-3">{answer}</p>
        </div>
      )}
    </div>
  );
}

// ── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-accent/10 text-accent",
    in_progress: "bg-primary/10 text-primary",
    waiting_client: "bg-orange-500/10 text-orange-500",
    resolved: "bg-muted text-muted-foreground",
    closed: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    waiting_client: "Awaiting you",
    resolved: "Resolved",
    closed: "Closed",
  };
  return (
    <span
      className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${map[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Support() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const CATEGORIES = CATEGORY_META.map((c) => ({
    ...c,
    label: t(`support.categories.${c.value}.label`),
    hint: t(`support.categories.${c.value}.hint`),
    placeholder: t(`support.categories.${c.value}.placeholder`),
  }));

  const { tickets, faqs } = useAppSelector((s) => s.portal);
  const [showForm, setShowForm] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryValue>("billing");
  const [openId, setOpenId] = useState<number | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    dispatch(fetchTickets());
    dispatch(fetchFaqs());
  }, [dispatch]);

  const activeCat =
    CATEGORIES.find((c) => c.value === selectedCategory) ?? CATEGORIES[0];

  const form = useFormik({
    initialValues: {
      subject: "",
      body: "",
      category: "billing" as CategoryValue,
      priority: "normal",
    },
    validationSchema: Yup.object({
      subject: Yup.string()
        .min(5, t("support.validation.subjectMin"))
        .required(t("support.validation.subjectRequired")),
      body: Yup.string()
        .min(20, t("support.validation.bodyMin"))
        .required(t("support.validation.bodyRequired")),
    }),
    onSubmit: async (values, { resetForm }) => {
      const r = await dispatch(createTicket(values));
      if (createTicket.fulfilled.match(r)) {
        resetForm();
        setShowForm(false);
        setSelectedCategory("billing");
        dispatch(fetchTickets());
      }
    },
  });

  const handleCategorySelect = (val: CategoryValue) => {
    setSelectedCategory(val);
    form.setFieldValue("category", val);
  };

  const openTicket = async (id: number) => {
    setOpenId((prev) => (prev === id ? null : id));
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
    <div className="space-y-8 max-w-3xl">
      <ClientPageHeader
        title={t("support.title")}
        icon={LifeBuoy}
        description={t("support.description")}
        actions={
          showForm ? (
            <button
              onClick={() => setShowForm(false)}
              className="btn-primary inline-flex items-center gap-1.5 shrink-0"
            >
              Cancel
            </button>
          ) : undefined
        }
      />

      {/* ── New Ticket Form ─────────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-border">
            <h2 className="text-base font-semibold">
              {t("support.createTicket")}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("support.createTicketDesc")}
            </p>
          </div>

          <form onSubmit={form.handleSubmit} className="p-6 space-y-5">
            {/* Category selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2 uppercase tracking-wide">
                {t("support.typeOfIssue")}
              </label>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = selectedCategory === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => handleCategorySelect(cat.value)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                        active
                          ? `${cat.bg} ${cat.border} ${cat.color}`
                          : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Context hint */}
            <div
              className={`flex gap-2.5 items-start rounded-xl px-4 py-3 border ${activeCat.bg} ${activeCat.border}`}
            >
              <AlertCircle
                className={`w-4 h-4 shrink-0 mt-0.5 ${activeCat.color}`}
              />
              <p className={`text-sm ${activeCat.color}`}>{activeCat.hint}</p>
            </div>

            {/* Subject */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("support.subjectLabel")}
              </label>
              <input
                placeholder={`Brief title — e.g. "Unrecognized charge on May 12"`}
                {...form.getFieldProps("subject")}
                className="w-full h-11 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
              {form.touched.subject && form.errors.subject && (
                <p className="text-xs text-destructive mt-1">
                  {form.errors.subject}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("support.descriptionLabel")}
              </label>
              <textarea
                placeholder={activeCat.placeholder}
                rows={5}
                {...form.getFieldProps("body")}
                className="w-full p-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary resize-y text-sm"
              />
              {form.touched.body && form.errors.body && (
                <p className="text-xs text-destructive mt-1">
                  {form.errors.body}
                </p>
              )}
            </div>

            {/* Priority */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {t("support.priorityLabel")}
              </label>
              <div className="flex gap-2">
                {(["low", "normal", "high"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => form.setFieldValue("priority", p)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors capitalize ${
                      form.values.priority === p
                        ? p === "high"
                          ? "bg-destructive/10 border-destructive/30 text-destructive"
                          : p === "normal"
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted border-border text-muted-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={form.isSubmitting}
                className="btn-primary disabled:opacity-50"
              >
                {form.isSubmitting
                  ? t("support.submitting")
                  : t("support.submitTicket")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── FAQ Section ─────────────────────────────────────────────────── */}
      {!showForm && faqs.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-primary" />
            {t("support.faqHeading")}
          </h2>
          <div className="space-y-2">
            {faqs.map((faq) => (
              <FaqItem
                key={faq.id}
                question={faq.question}
                answer={faq.answer}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            {t("support.faqCta")}{" "}
            <button
              className="text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => setShowForm(true)}
            >
              {t("support.openTicket")}
            </button>{" "}
            {t("support.faqCtaEnd")}
          </p>
        </div>
      )}

      {/* ── Ticket List ─────────────────────────────────────────────────── */}
      <div>
        {tickets.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border p-10 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">{t("support.noTickets")}</p>
            {faqs.length === 0 && (
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 btn-primary"
              >
                {t("support.openTicket")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Your tickets</h2>
            {tickets.map((t) => {
              const cat = CATEGORIES.find((c) => c.value === t.category);
              const Icon = cat?.icon ?? HelpCircle;
              return (
                <div
                  key={t.id}
                  className="bg-card rounded-2xl border border-border hover:border-primary/30 transition-colors overflow-hidden"
                >
                  <button
                    type="button"
                    className="w-full text-left p-5"
                    onClick={() => openTicket(t.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${cat?.bg ?? "bg-muted"}`}
                        >
                          <Icon
                            className={`w-4 h-4 ${cat?.color ?? "text-muted-foreground"}`}
                          />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold leading-snug">
                            {t.subject}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                            {cat?.label ?? t.category} ·{" "}
                            {new Date(t.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  </button>

                  {openId === t.id && (
                    <div className="border-t border-border bg-muted/20 p-5 space-y-3">
                      {replies.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          No replies yet — our team will respond shortly.
                        </p>
                      ) : (
                        replies.map((r: any) => (
                          <div
                            key={r.id}
                            className={`p-3 rounded-xl text-sm ${
                              r.author_type === "client"
                                ? "bg-primary/5 ml-8 border border-primary/10"
                                : "bg-card border border-border mr-8"
                            }`}
                          >
                            <div className="text-xs text-muted-foreground mb-1 font-medium">
                              {r.author_type === "client" ? "You" : "Support"} ·{" "}
                              {new Date(r.created_at).toLocaleString()}
                            </div>
                            <div className="whitespace-pre-wrap leading-relaxed">
                              {r.body}
                            </div>
                          </div>
                        ))
                      )}

                      {!["resolved", "closed"].includes(t.status) && (
                        <div className="flex gap-2 pt-1">
                          <input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Write a reply…"
                            className="flex-1 h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                submitReply();
                              }
                            }}
                          />
                          <button
                            onClick={submitReply}
                            className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center gap-1.5"
                          >
                            <Send className="w-4 h-4" /> Send
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
